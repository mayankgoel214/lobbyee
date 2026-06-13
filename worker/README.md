# Lobbyee Voice Worker (Phase 5)

Python home for the real-time voice pipeline. Lives outside the Next.js app
because voice needs a long-running WebRTC process (Vercel can't hold one) —
see `docs/phase-5-plan.md`.

## M0 — iPhone voice-feasibility spike ✅ PASSED (2026-06-12)

`bot.py` is the **throwaway M0 spike** — the official Pipecat quickstart adapted
to run locally and use Gemini. It exists only to answer the #1 risk in the plan:
**does real-time voice work on a real iPhone?**

**Result: YES.** Verified end-to-end with simulated audio (a speech clip fed as a
fake mic) and then confirmed live on a physical iPhone over Safari:

- WebRTC connect (SmallWebRTC, browser ↔ local bot) — works
- Deepgram STT transcribed real speech — TTFB ~0.3s
- Gemini (`gemini-2.5-flash`) replied — TTFB ~0.5s
- Cartesia TTS spoke the reply — TTFB ~0.2s

All sub-second. The iPhone (Safari tab) captured mic + played audio correctly.

> Caveat: this tested iOS Safari **in a browser tab**, not yet the **installed
> PWA** mode (the deeper documented risk). That gets verified when the real
> voice client lands (plan M4/M5), since the Lobbyee app itself is a PWA.

## How to run the spike (local, free)

```bash
cd worker
uv venv --python 3.12            # first time only
source .venv/bin/activate
uv pip install "pipecat-ai[webrtc,silero,deepgram,cartesia,google,runner]" \
    pipecat-ai-cli python-dotenv  # first time only
python bot.py                     # serves http://localhost:7860/client
```

Reuses keys from the repo's `../.env.local` (`DEEPGRAM_API_KEY`,
`CARTESIA_API_KEY`, `GEMINI_API_KEY`). To reach it from a phone, tunnel it:

```bash
cloudflared tunnel --url http://localhost:7860   # → https://<random>.trycloudflare.com
```

Open `https://<random>.trycloudflare.com/client/` on the phone, tap Connect.
(iOS needs HTTPS for the mic — hence the tunnel; a plain LAN IP won't work.)

## M3 — the real worker: `lobbyee_bot.py`

`bot.py` stays as the M0 reference. `lobbyee_bot.py` is the real thing: it runs
ONE session's audio loop and talks to the app over the contract in
[`../lib/voice/wire-contract.md`](../lib/voice/wire-contract.md). It holds no DB
credentials and no AI prompts — the app renders the guest prompt, reads mood, and
coaches; the worker only does audio + the guest reply and posts each turn back.

> Status: first cut, **not yet verified live**. Expect a debugging pass against a
> real device (Pipecat frame/event APIs are version-sensitive).

### One-time app setup (enables voice)

Voice is dark until a signing secret is set. Generate one and add it to
`../.env.local` (and later Vercel), then restart `pnpm dev`:

```bash
openssl rand -base64 48          # paste as VOICE_SESSION_TOKEN_SECRET=... in .env.local
```

Also install the worker's HTTP client (once):

```bash
source .venv/bin/activate
uv pip install httpx
```

### Run + test (local, with your phone)

1. **Start a training session** in the browser (logged in as your test manager)
   so there's an `in_progress` session with the guest's opening line. Copy its
   **sessionId** from the URL (`/w/<slug>/sessions/<sessionId>`).
2. **Mint a token** — in the browser devtools console (uses your login cookie):
   ```js
   fetch('/api/voice/session-token', {
     method: 'POST',
     headers: { 'content-type': 'application/json' },
     body: JSON.stringify({ sessionId: '<sessionId>' }),
   }).then(r => r.json()).then(console.log)   // → { token, sessionId }
   ```
3. **Run the worker** with that token:
   ```bash
   source .venv/bin/activate
   VOICE_SESSION_TOKEN='<token>' python lobbyee_bot.py   # serves :7860/client
   ```
4. **Tunnel + connect from the phone** (HTTPS required for the mic):
   ```bash
   cloudflared tunnel --url http://localhost:7860
   ```
   Open `https://<random>.trycloudflare.com/client/`, tap Connect, talk. The
   guest should speak its opening line, then respond in character; each turn lands
   in the DB (check the session transcript in the app) with mood + coach hint.

Notes: `LOBBYEE_BASE_URL` defaults to `http://localhost:3000` (point it at the
tunnel/prod URL if the app isn't local). `VOICE_GUEST_MODEL` defaults to
`gemini-2.5-flash` — switch to the app's guest model once parity is confirmed.

## M4 — in-app voice screen (`feat/voice-ui`)

Lobbyee's own voice UI (`features/sessions/voice-room.tsx`) connects the
browser's mic straight to this worker over WebRTC — no more `/client` test page.
The worker is unchanged: it's still bound to one session via its env token (same
shape a per-session worker gets in prod), and the browser only carries audio.

### Test it end-to-end (local + phone)

1. **Restart `pnpm dev`** — the `voice_enabled` column + the new
   `NEXT_PUBLIC_PIPECAT_WORKER_URL` are only picked up on a fresh start.
   - For a phone, set `NEXT_PUBLIC_PIPECAT_WORKER_URL` to the worker's tunnel
     URL in `.env.local` before starting; on the same Mac, the default
     `http://localhost:7860` is fine.
2. **Enable voice** for your workspace (once):
   `UPDATE workspace SET voice_enabled = true WHERE slug = '<your-slug>';`
   (already done for `qa-test-hotel`).
3. In the app: **Train → toggle Voice → Start session.** You land on the voice
   screen. Copy the **sessionId** from the URL.
4. **Start the worker for THAT session** (its token must match the open session):
   ```bash
   cd worker && source .venv/bin/activate
   VOICE_SESSION_TOKEN=$(node scripts/mint.mjs <sessionId> <workspaceId> <userId>) python lobbyee_bot.py
   ```
   (Get workspaceId/userId from the session row, or reuse the values in the repo
   memory for the test account.)
5. Back in the app, tap **🎙️ Connect & talk**. The guest should speak its
   opener, then converse; turns persist (check the transcript after **End**).

### Known integration points to verify on the first live run

- **CORS:** the app origin (`:3000`/tunnel) connecting to the worker
  (`:7860`/tunnel) is cross-origin. If `Connect & talk` fails on a CORS error,
  the worker's `/api/offer` needs `Access-Control-Allow-Origin` for the app
  origin (small addition to the runner setup).
- **Offer endpoint** path is assumed `/api/offer` (Pipecat SmallWebRTC default).
- **Live coach strip:** the screen shows the *opening* hint; per-turn coach
  updates during a call need the worker to push a message to the browser
  (RTVI) — deferred follow-up.

## After M4

M5 = installed-PWA exit gate on a real iPhone + the production worker-hosting
decision (per-connection tokens or a per-session spawner, since Pipecat Cloud
needs a card). M6 = audio persistence + 90-day retention cron.
