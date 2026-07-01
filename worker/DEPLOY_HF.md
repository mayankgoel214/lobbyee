# Deploy the voice worker — Hugging Face Spaces (no credit card)

The no-card path. Hosts the multi-session worker on a free Hugging Face Docker
Space (~16 GB RAM, stays warm). Media still needs a TURN relay (free Metered
tier). Two free accounts, **zero credit cards**. See `DEPLOY.md` for the Fly path.

## 1. Two free accounts (no card on either)

**Hugging Face** — sign up at <https://huggingface.co> → Settings → Access Tokens
→ **New token**, role **write**. Copy it.

**Metered** (TURN/audio relay) — sign up at <https://www.metered.ca> → **TURN** →
copy the server URLs + your username + credential. Free tier = 50 GB/month.

## 2. Put them in `.env.local` (repo root)

The deploy script reads these and never prints them:

```
HF_TOKEN=hf_xxxxxxxx
VOICE_TURN_URLS=turn:standard.relay.metered.ca:80,turns:standard.relay.metered.ca:443
VOICE_TURN_USERNAME=your_metered_username
VOICE_TURN_CREDENTIAL=your_metered_credential
```

(The 3 AI keys — DEEPGRAM/CARTESIA/GEMINI — are already there.)

## 3. Deploy (one command)

```bash
cd worker && .venv/bin/python scripts/deploy_hf.py
```

It creates a **public** Docker Space `lobbyee-voice`, uploads the worker, sets all
secrets, and triggers a build (~3–6 min the first time). It writes the two values
you'll add to Vercel into `worker/vercel-voice-env.txt` (gitignored).

> The Space is public because the trainee's browser reaches it with no HF login.
> It's safe: every call the worker makes is token-validated by the app, and the
> API keys live in Space secrets — never in the code or the URL.

## 4. Point the app at the worker (Vercel)

Open `worker/vercel-voice-env.txt` and add both to **Vercel → Project → Settings →
Environment Variables → Production**, then redeploy:

- `NEXT_PUBLIC_PIPECAT_WORKER_URL` — the Space URL (`https://<user>-lobbyee-voice.hf.space`)
- `NEXT_PUBLIC_VOICE_ICE_SERVERS` — the TURN JSON (so the browser uses the same relay)

Confirm `VOICE_SESSION_TOKEN_SECRET` is already set on Vercel (it mints the token).

## 5. Verify

- `curl https://<user>-lobbyee-voice.hf.space/health` → `{"status":"ok"}`
- In the app: Train → Voice → Start → **Connect & talk**. First connection after
  the Space has been idle takes a few seconds to wake.

## Cost

- Hugging Face Space: **$0** (free tier).
- Metered TURN: **$0** up to 50 GB/month.
- Per session: only the AI usage (Deepgram + Cartesia + Gemini), a few cents.

No fixed cost, no card.
