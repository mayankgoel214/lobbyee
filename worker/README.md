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

## Next (plan M2+)

`bot.py` gets replaced by the real worker: load a Lobbyee persona/scenario/
session, drive the **shared turn-engine contract** (`lib/turn-engine/`), persist
messages with RLS like `lib/db/scoped.ts`, and deploy to a host. The throwaway
quickstart UI gives way to Lobbyee's own voice screen (M4).
