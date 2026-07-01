# Deploying the Lobbyee voice worker (Fly.io)

The worker is **multi-session**: one always-on container serves every trainee.
Each browser mints its own short-lived token and hands it to the worker on
connect (see `lib/voice/wire-contract.md`). The worker holds no DB credentials
and no token secret — it forwards the opaque token; the app validates it.

This guide has the parts that need **your** accounts. Run them once.

---

## 0. What you'll set up

| Piece | Why | Cost |
|---|---|---|
| Fly.io app | runs the worker container | ~$5–15/mo (1 shared-cpu, 1GB; suspends when idle) |
| TURN relay (Metered) | carries the WebRTC **audio** (see below) | free tier (50 GB/mo) |
| Vercel env vars | point the app at the worker + TURN | — |

### Why TURN is required (not optional on Fly)
The HTTPS **signaling** (`/api/offer`) goes through Fly's proxy fine. But the
actual **audio** is WebRTC media over UDP on random ports that Fly can't route.
A TURN server relays that media through one known address, so it works on Fly
*and* behind strict hotel/corporate firewalls. Without it, callers will connect
but hear silence. The code already supports TURN via env — you just supply creds.

---

## 1. Get TURN credentials (Metered — free, simplest)

1. Sign up at <https://www.metered.ca/> → **TURN Server** → create an app.
2. Copy the **static credentials**: a list of `urls`, a `username`, a `credential`.
   They look like:
   - urls: `turn:standard.relay.metered.ca:80`, `turn:standard.relay.metered.ca:443`, `turns:standard.relay.metered.ca:443?transport=tcp`
   - username: `xxxxxxxx`
   - credential: `yyyyyyyy`

(Alternatives: Cloudflare Realtime TURN, Twilio NTS — both work; Metered's free
tier is the least friction to start.)

---

## 2. Deploy the worker to Fly

```bash
# one-time: install + sign in
brew install flyctl          # or: curl -L https://fly.io/install.sh | sh
fly auth login

cd worker
# adopt the existing fly.toml (don't let it scaffold a new one)
fly launch --no-deploy --copy-config --name lobbyee-voice --region iad
```

Set the worker secrets (these are NOT in fly.toml — they're secret):

```bash
fly secrets set \
  DEEPGRAM_API_KEY=...  \
  CARTESIA_API_KEY=...  \
  GEMINI_API_KEY=...    \
  VOICE_TURN_URLS="turn:standard.relay.metered.ca:80,turn:standard.relay.metered.ca:443,turns:standard.relay.metered.ca:443?transport=tcp" \
  VOICE_TURN_USERNAME="<metered username>" \
  VOICE_TURN_CREDENTIAL="<metered credential>"
```

> Use the SAME Deepgram/Cartesia/Gemini keys as your local `.env.local`. The
> worker does **not** need `VOICE_SESSION_TOKEN_SECRET`.

`LOBBYEE_BASE_URL` and `VOICE_ALLOWED_ORIGINS` are already set to
`https://lobbyee.vercel.app` in `fly.toml` — edit there if your domain differs.

Deploy:

```bash
fly deploy
fly logs                       # watch it boot; you want "voice server (multi-session) on :8080"
curl https://lobbyee-voice.fly.dev/health     # → {"status":"ok"}
```

---

## 3. Point the app at the worker (Vercel)

Set these on the Vercel project (Production), then redeploy the app:

```
NEXT_PUBLIC_PIPECAT_WORKER_URL = https://lobbyee-voice.fly.dev
NEXT_PUBLIC_VOICE_ICE_SERVERS  = [{"urls":["stun:stun.l.google.com:19302"]},{"urls":["turn:standard.relay.metered.ca:80","turn:standard.relay.metered.ca:443","turns:standard.relay.metered.ca:443?transport=tcp"],"username":"<metered username>","credential":"<metered credential>"}]
VOICE_SESSION_TOKEN_SECRET     = <same secret the app already uses to mint tokens>
```

Notes:
- `NEXT_PUBLIC_VOICE_ICE_SERVERS` is a JSON array of `RTCIceServer`. The browser
  needs the TURN creds too (that's how TURN works); they're low-sensitivity.
- `VOICE_SESSION_TOKEN_SECRET` must already be set on Vercel for voice to work at
  all (the mint endpoint uses it). Confirm it's there.

---

## 4. Verify end-to-end

1. Open the live app → **Train → Voice → Start session**.
2. **Connect & talk.** You should hear the guest greet you and reply as you speak,
   with the live transcript + coach + analytics panel updating.
3. If you connect but hear **silence**, TURN isn't being used — re-check the
   `VOICE_TURN_*` secrets (worker) and `NEXT_PUBLIC_VOICE_ICE_SERVERS` (Vercel)
   match, then `fly logs` should show `TURN configured`.

---

## Cost & scaling notes

- `min_machines_running = 0` + `auto_stop_machines = "suspend"`: the machine
  suspends when idle and wakes on the next connection (~1–2s cold start). Set
  `min_machines_running = 1` in `fly.toml` to remove that first-connect delay
  (costs more — one machine always on).
- One `shared-cpu-1x` / 1GB machine handles several concurrent sessions. Bump VM
  size or add machines (`fly scale count 2`) when you have real load.
- Metered free tier = 50 GB/mo of relayed audio (~hundreds of hours of voice).
  Watch usage in their dashboard; upgrade or switch providers if you outgrow it.

## Local development

Local still works without any of this: `cd worker && source .venv/bin/activate`
then `python lobbyee_bot.py` (multi-session, STUN-only — fine on localhost). The
in-app screen mints + passes the token automatically.
