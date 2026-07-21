#
# Lobbyee Phase 5 — the voice worker (M3 + production handshake).
#
# Runs a training session's live audio loop: STT (Deepgram) → guest reply
# (Gemini) → TTS (Cartesia), over WebRTC. It is deliberately DUMB about the
# domain — it holds no DB credentials and no AI prompts. Everything domain-
# specific comes from / goes to the app over the contract in
# ../lib/voice/wire-contract.md, authenticated by a short-lived bearer token:
#
#   on connect : GET  /api/voice/worker/snapshot  → system prompt, history, mood
#   each turn  : POST /api/voice/worker/turn       → app computes mood + coach,
#                                                     persists, returns next mood
#
# The app does the mood-reading and coaching (reusing the text-path AI), so the
# grading rubric never reaches this process. We only inject the per-turn mood
# note onto the staff member's words (same stage-direction the text path uses)
# and report the two lines of dialogue back.
#
# Two run modes (see __main__ at the bottom):
#   • MULTI-SESSION (production): no VOICE_SESSION_TOKEN env → serve() runs a
#     FastAPI server; each browser POSTs its own minted token in the WebRTC
#     offer's requestData, so ONE process serves every trainee concurrently.
#   • SINGLE-SESSION (legacy local): VOICE_SESSION_TOKEN set → Pipecat's dev
#     runner, bound to that one session. Handy for a quick local run.
#
# Config (env):
#   LOBBYEE_BASE_URL      app base (default http://localhost:3000)
#   PORT                  server port (default 7860)
#   VOICE_ALLOWED_ORIGINS CORS allow-list, comma-sep (default "*")
#   VOICE_VAD_STOP_SECS   pause tolerance before end-of-turn (default 1.5s)
#   VOICE_GUEST_MODEL     default gemini-2.5-flash
#   DEEPGRAM_API_KEY / CARTESIA_API_KEY / GEMINI_API_KEY
#   VOICE_SESSION_TOKEN   set ONLY for the legacy single-session local run.
# The worker never needs VOICE_SESSION_TOKEN_SECRET — it treats the token as
# opaque; the app validates it.
#
# Run (production multi-session):  python lobbyee_bot.py
# Run (single-session local):      VOICE_SESSION_TOKEN=... python lobbyee_bot.py
#
import asyncio
import os
import uuid
from collections import deque
from pathlib import Path

import httpx
from dotenv import load_dotenv
from loguru import logger

from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.frames.frames import Frame, TranscriptionFrame, TTSSpeakFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.processors.frameworks.rtvi import RTVIProcessor
from pipecat.runner.types import RunnerArguments
from pipecat.runner.utils import create_transport
from pipecat.services.cartesia.tts import CartesiaTTSService
from pipecat.services.deepgram.stt import DeepgramSTTService
from pipecat.services.google.llm import GoogleLLMService
from pipecat.transports.base_transport import BaseTransport, TransportParams

# Reuse the repo's keys (DEEPGRAM/CARTESIA/GEMINI). The voice token + app URL are
# passed per-run, NOT stored here.
load_dotenv(Path(__file__).resolve().parent.parent / ".env.local", override=True)

BASE_URL = os.getenv("LOBBYEE_BASE_URL", "http://localhost:3000").rstrip("/")
TOKEN = os.getenv("VOICE_SESSION_TOKEN")
GUEST_MODEL = os.getenv("VOICE_GUEST_MODEL", "gemini-2.5-flash")
# Cartesia "British Reading Lady" — same voice as the M0 spike. Pick per persona later.
TTS_VOICE = os.getenv("VOICE_TTS_VOICE", "71a7ad14-091c-4e8e-a314-022ece01c121")
# Production server (serve()) config. PORT is what the host expects to bind.
# VOICE_ALLOWED_ORIGINS locks CORS to the app origin(s) in prod (comma-separated);
# default "*" is fine since the worker doesn't trust the request itself — the app
# validates the token on every snapshot/turn call. The browser sends no cookies
# here (the token rides the offer body), so credentials stay off.
PORT = int(os.getenv("PORT", "7860"))
ALLOWED_ORIGINS = [
    o.strip() for o in os.getenv("VOICE_ALLOWED_ORIGINS", "*").split(",") if o.strip()
]
# How long a trainee can pause mid-sentence before the guest takes its turn.
# Silero's own default is 0.8s — short enough that a natural "let me think…"
# pause gets registered as end-of-turn and the guest jumps in on a half-finished
# sentence. We widen it to 1.5s: enough to ride out a thinking pause while still
# feeling like a live conversation. Tunable per taste without a code change —
# ~1.2s = snappier, ~2.0s = more patient. (A semantic end-of-turn model is the
# heavier follow-up if a fixed window ever proves too blunt.)
VAD_STOP_SECS = float(os.getenv("VOICE_VAD_STOP_SECS", "1.5"))

logger.info(f"Lobbyee voice worker → {BASE_URL} (guest model: {GUEST_MODEL})")


def _auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


class MoodInjector(FrameProcessor):
    """Prefixes the current mood note onto the staff member's transcription so the
    guest LLM sees the same private '[Guest mood …]' stage direction the text
    path injects — and records the CLEAN (note-free) user text for persistence.

    Sits between the STT service and the user context aggregator.
    """

    def __init__(self, state: dict):
        super().__init__()
        self._state = state  # shared: {"mood_note": str, "pending_users": deque[str]}

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, TranscriptionFrame) and frame.text.strip():
            clean = frame.text.strip()
            # FIFO queue so that under barge-in / two fast utterances we pair the
            # OLDEST user line with the next guest reply (not the most recent one).
            self._state["pending_users"].append(clean)
            note = self._state.get("mood_note") or ""
            await self.push_frame(
                TranscriptionFrame(
                    text=f"{note}\n\n{clean}" if note else clean,
                    user_id=frame.user_id,
                    timestamp=frame.timestamp,
                ),
                direction,
            )
            return
        await self.push_frame(frame, direction)


async def _post_turn(
    client: httpx.AsyncClient,
    state: dict,
    rtvi: RTVIProcessor,
    token: str,
    idempotency_key: str,
    user_text: str,
    guest_text: str,
):
    """Persist one completed turn and adopt the mood the app returns for the next
    guest reply. Bounded retry (3 attempts, exp backoff) on 5xx / network errors,
    REUSING the same idempotency key per wire-contract §2.

    On a successful save, ADDITIVELY push the live coach hint + the two dialogue
    lines to the connected client as a custom RTVI server message so the in-app
    coach strip + transcript update per turn. This is presentation-only — the
    same coachHint the app already returns here — and a failure to send it must
    NOT lose the turn (it's already persisted)."""
    body = {
        "idempotencyKey": idempotency_key,
        "userText": user_text,
        "guestText": guest_text,
    }
    backoffs = [0.5, 1.0, 2.0]  # 3 attempts: initial + 2 retries
    for attempt, delay in enumerate(backoffs):
        try:
            r = await client.post(
                f"{BASE_URL}/api/voice/worker/turn",
                json=body,
                headers=_auth_headers(token),
                timeout=15,
            )
        except Exception as e:  # noqa: BLE001 — network/timeout: retryable
            if attempt < len(backoffs) - 1:
                logger.warning(
                    f"turn POST network error (attempt {attempt + 1}/{len(backoffs)}): {e} — retrying in {delay}s"
                )
                await asyncio.sleep(delay)
                continue
            logger.error(f"turn POST failed after {len(backoffs)} attempts (turn not saved): {e}")
            return

        if r.status_code == 200:
            data = r.json()
            state["mood_note"] = data.get("moodNote") or state.get("mood_note") or ""
            logger.info(
                f"turn saved @{data.get('guestTurnIndex')} status={data.get('status')}"
            )
            # Additive live-coaching push: send the coach hint + this turn's two
            # lines to the client. Best-effort — the turn is already persisted, so
            # a send failure here must not surface as a lost turn.
            try:
                # Bounded so a send that blocks while the transport is closing
                # (on disconnect) can't stall the on_client_disconnected drain.
                await asyncio.wait_for(
                    rtvi.send_server_message(
                        {
                            "type": "coach",
                            "coachHint": data.get("coachHint"),
                            # The app's freshly-read guest mood vector for this turn
                            # ({frustration,trust,patience,satisfaction} 0-100) —
                            # drives the in-app live analytics panel. Presentation-only.
                            "mood": data.get("mood"),
                            "userText": user_text,
                            "guestText": guest_text,
                        }
                    ),
                    timeout=2.0,
                )
            except Exception as e:  # noqa: BLE001 — push is best-effort (incl. timeout)
                logger.warning(f"coach server-message push failed (turn still saved): {e}")
            return
        if r.status_code == 409:
            # Terminal: session ended or real ordering collision — don't retry.
            logger.warning("turn rejected (409) — session ended or out of order")
            return
        if 400 <= r.status_code < 500:
            # Terminal: bad body / auth / not-found — retrying won't help.
            logger.error(f"turn POST {r.status_code} (terminal): {r.text[:200]}")
            return
        # 5xx — retryable.
        if attempt < len(backoffs) - 1:
            logger.warning(
                f"turn POST {r.status_code} (attempt {attempt + 1}/{len(backoffs)}): {r.text[:200]} — retrying in {delay}s"
            )
            await asyncio.sleep(delay)
            continue
        logger.error(
            f"turn POST {r.status_code} after {len(backoffs)} attempts: {r.text[:200]}"
        )


async def run_bot(transport: BaseTransport, runner_args: RunnerArguments, token: str):
    # `token` is this CONNECTION's voice token (browser-minted, see bot()). It
    # scopes every app call below to exactly this session — so one worker process
    # serves many concurrent trainees, each with their own token.
    if not token:
        # A connection with no token can't be served. Return without building the
        # pipeline; the runner tears the bare connection down. Crucially we do NOT
        # exit the process — that would kill every other in-flight session.
        logger.error("connection has no voice token — refusing to run a session")
        return

    client = httpx.AsyncClient()

    # 1) Fetch what we need to run this session.
    r = await client.get(
        f"{BASE_URL}/api/voice/worker/snapshot",
        headers=_auth_headers(token),
        timeout=15,
    )
    if r.status_code != 200:
        logger.error(f"snapshot fetch failed ({r.status_code}): {r.text[:200]}")
        await client.aclose()
        return
    snap = r.json()

    # 2) Seed the LLM context: prior turns (guest → assistant, user → user).
    messages = [
        {
            "role": "assistant" if m["role"] == "guest" else "user",
            "content": m["text"],
        }
        for m in snap.get("history", [])
    ]
    state = {"mood_note": snap.get("moodNote", ""), "pending_users": deque()}
    # Track in-flight turn POSTs so we can drain them on disconnect before
    # closing the shared httpx client.
    pending_posts: set[asyncio.Task] = set()
    # The guest's opening line (already persisted at session start) — we speak it
    # aloud on connect so the trainee hears the guest start.
    opener = next(
        (m["text"] for m in reversed(snap.get("history", [])) if m["role"] == "guest"),
        None,
    )

    stt = DeepgramSTTService(api_key=os.getenv("DEEPGRAM_API_KEY"))
    tts = CartesiaTTSService(
        api_key=os.getenv("CARTESIA_API_KEY"),
        settings=CartesiaTTSService.Settings(voice=TTS_VOICE),
    )
    llm = GoogleLLMService(
        api_key=os.getenv("GEMINI_API_KEY"),
        settings=GoogleLLMService.Settings(
            model=GUEST_MODEL,
            system_instruction=snap["guestSystemPrompt"],
        ),
    )

    context = LLMContext(messages)
    mood_injector = MoodInjector(state)
    user_aggregator, assistant_aggregator = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(
            # stop_secs is the pause tolerance: how long the trainee can go quiet
            # mid-sentence before we treat the turn as finished. See VAD_STOP_SECS.
            vad_analyzer=SileroVADAnalyzer(
                params=VADParams(stop_secs=VAD_STOP_SECS)
            ),
        ),
    )

    # RTVI processor: lets us push custom server messages (the per-turn coach
    # hint) down to the connected client. Must sit upstream of transport.output()
    # so send_server_message's frame reaches the transport. Its observer is added
    # to the task below (Pipecat requires both, or it logs an error).
    rtvi = RTVIProcessor(transport=transport)

    pipeline = Pipeline(
        [
            transport.input(),
            rtvi,  # carries server messages (coach hints) out to the client
            stt,
            mood_injector,  # prefix mood note onto the user's words
            user_aggregator,
            llm,
            tts,
            transport.output(),
            assistant_aggregator,
        ]
    )
    task = PipelineTask(
        pipeline,
        params=PipelineParams(enable_metrics=True, enable_usage_metrics=True),
        observers=[rtvi.create_rtvi_observer()],
    )

    @assistant_aggregator.event_handler("on_assistant_turn_stopped")
    async def on_assistant_turn_stopped(aggregator, message):
        guest_text = (getattr(message, "content", "") or "").strip()
        queue: deque = state["pending_users"]
        # Empty queue → this is the spoken opener, already persisted; skip.
        if not guest_text or not queue:
            return
        user_text = queue.popleft()
        # Mint the idempotency key ONCE here so retries inside _post_turn reuse it.
        idempotency_key = str(uuid.uuid4())
        t = asyncio.create_task(
            _post_turn(
                client, state, rtvi, token, idempotency_key, user_text, guest_text
            )
        )
        pending_posts.add(t)
        t.add_done_callback(pending_posts.discard)

    @transport.event_handler("on_client_connected")
    async def on_client_connected(transport, _client):
        logger.info("Trainee connected")
        if opener:
            await task.queue_frames([TTSSpeakFrame(opener)])

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(transport, _client):
        logger.info("Trainee disconnected — ending session")
        # Drain in-flight turn POSTs before closing the shared httpx client,
        # otherwise the final turn(s) raise mid-flight and get lost.
        if pending_posts:
            logger.info(f"Draining {len(pending_posts)} in-flight turn POST(s)")
            await asyncio.gather(*pending_posts, return_exceptions=True)
        await task.cancel()
        await client.aclose()

    runner = PipelineRunner(handle_sigint=runner_args.handle_sigint)
    await runner.run(task)


def _token_from(runner_args: RunnerArguments) -> str:
    """The connection's voice token. In production the browser mints it and sends
    it as `requestData: { token }` on connect — the runner threads that to us as
    `runner_args.body`. Falls back to the VOICE_SESSION_TOKEN env var so a single
    -session local run (no browser handshake) still works."""
    body = getattr(runner_args, "body", None)
    if isinstance(body, dict):
        tok = body.get("token")
        if isinstance(tok, str) and tok:
            return tok
    return TOKEN or ""


async def bot(runner_args: RunnerArguments):
    """Per-connection entry point. The runner invokes this once per browser that
    connects to /api/offer, so a single worker process serves many sessions —
    each scoped by its own token (see _token_from)."""
    token = _token_from(runner_args)
    transport_params = {
        "webrtc": lambda: TransportParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
        ),
    }
    transport = await create_transport(runner_args, transport_params)
    await run_bot(transport, runner_args, token)


async def serve():
    """Production server — MULTI-SESSION. One process serves every trainee: each
    browser POSTs an SDP offer to /api/offer with its own minted token in
    `requestData`, and we run that session scoped to the token (see bot() /
    _token_from). One worker, many concurrent sessions.

    We own this thin layer (rather than `pipecat.runner.run.main`) for one
    reason: the dev runner's typed /api/offer lets FastAPI parse the body
    straight into the SmallWebRTCRequest dataclass, which only reads snake_case
    `request_data` and silently drops the client SDK's camelCase `requestData` —
    so the token never reaches the bot. Building the request via
    `SmallWebRTCRequest.from_dict` (which maps camelCase) fixes that. We reuse
    Pipecat's SmallWebRTCRequestHandler, so pc_id reuse, renegotiation, and ICE
    trickle work exactly as upstream."""
    from contextlib import asynccontextmanager

    import uvicorn
    from fastapi import BackgroundTasks, FastAPI
    from fastapi.middleware.cors import CORSMiddleware
    from pipecat.runner.types import SmallWebRTCRunnerArguments
    from pipecat.transports.smallwebrtc.connection import (
        IceServer,
        SmallWebRTCConnection,
    )
    from pipecat.transports.smallwebrtc.request_handler import (
        IceCandidate,
        SmallWebRTCPatchRequest,
        SmallWebRTCRequest,
        SmallWebRTCRequestHandler,
    )

    # ICE servers. STUN alone suffices on permissive networks, but on a cloud
    # host (Fly) the worker's media uses ephemeral UDP ports the platform can't
    # route — a TURN relay is what actually carries the audio there. Configure it
    # via env (VOICE_TURN_URLS, VOICE_TURN_USERNAME, VOICE_TURN_CREDENTIAL); the
    # browser must point at the SAME TURN (NEXT_PUBLIC_VOICE_ICE_SERVERS).
    ice_servers = [IceServer(urls="stun:stun.l.google.com:19302")]
    turn_urls = os.getenv("VOICE_TURN_URLS", "").strip()
    if turn_urls:
        turn_user = os.getenv("VOICE_TURN_USERNAME") or None
        turn_cred = os.getenv("VOICE_TURN_CREDENTIAL") or None
        ice_servers += [
            IceServer(urls=u.strip(), username=turn_user, credential=turn_cred)
            for u in turn_urls.split(",")
            if u.strip()
        ]
        logger.info(f"TURN configured ({len(ice_servers) - 1} relay url(s))")
    else:
        logger.warning(
            "No TURN configured (VOICE_TURN_URLS unset) — STUN only. Media may "
            "fail behind strict NATs or on a cloud host; see worker/DEPLOY.md."
        )

    handler = SmallWebRTCRequestHandler(  # ConnectionMode.MULTIPLE by default
        ice_servers=ice_servers
    )

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        yield
        # Best-effort: close any peer connections still open at shutdown.
        close = getattr(handler, "close", None)
        if close:
            await close()

    app = FastAPI(lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    @app.post("/api/offer")
    async def offer(raw: dict, background_tasks: BackgroundTasks):
        req = SmallWebRTCRequest.from_dict(dict(raw))

        async def on_connection(connection: SmallWebRTCConnection):
            runner_args = SmallWebRTCRunnerArguments(
                webrtc_connection=connection,
                body=req.request_data,
                session_id=None,
            )
            background_tasks.add_task(bot, runner_args)

        return await handler.handle_web_request(
            request=req, webrtc_connection_callback=on_connection
        )

    @app.patch("/api/offer")
    async def ice_candidate(raw: dict):
        patch = SmallWebRTCPatchRequest(
            pc_id=raw["pc_id"],
            candidates=[IceCandidate(**c) for c in raw.get("candidates", [])],
        )
        await handler.handle_patch_request(patch)
        return {"status": "success"}

    logger.info(f"Lobbyee voice server (multi-session) on :{PORT}")
    server = uvicorn.Server(
        uvicorn.Config(app, host="0.0.0.0", port=PORT, log_level="info")
    )
    await server.serve()


if __name__ == "__main__":
    # If a single session's token is pinned in the env, use Pipecat's dev runner
    # (legacy single-session local run). Otherwise serve the multi-session
    # production server, where each browser brings its own token.
    if TOKEN:
        from pipecat.runner.run import main

        main()
    else:
        asyncio.run(serve())
