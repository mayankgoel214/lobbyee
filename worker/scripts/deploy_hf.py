#!/usr/bin/env python3
"""One-shot deploy of the Lobbyee voice worker to a Hugging Face Docker Space.

NO credit card required. Reads HF_TOKEN + the worker secrets from ../.env.local,
creates (or updates) a PUBLIC Docker Space, uploads the worker, sets the Space
secrets, and triggers a build. Writes the two values you paste into Vercel to
`worker/vercel-voice-env.txt` (gitignored) — and never prints any secret value.

Why public: the trainee's browser POSTs its WebRTC offer to the Space's URL with
no Hugging Face login, so the app must be public. It's safe — every snapshot/turn
call the worker makes is token-validated by the app, and the API keys live in
Space secrets, never in the code or the URL.

Usage:  cd worker && .venv/bin/python scripts/deploy_hf.py
"""

import json
import sys
from pathlib import Path

WORKER_DIR = Path(__file__).resolve().parent.parent
ENV_PATH = WORKER_DIR.parent / ".env.local"
SPACE_NAME = "lobbyee-voice"
APP_URL = "https://lobbyee.vercel.app"  # prod app the worker calls back into

# Runtime secrets set on the Space (never printed). The worker does NOT need
# VOICE_SESSION_TOKEN_SECRET — it treats the token as opaque; the app validates.
AI_KEYS = ["DEEPGRAM_API_KEY", "CARTESIA_API_KEY", "GEMINI_API_KEY"]
TURN_KEYS = ["VOICE_TURN_URLS", "VOICE_TURN_USERNAME", "VOICE_TURN_CREDENTIAL"]


def parse_env(path: Path) -> dict:
    env = {}
    if not path.exists():
        return env
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def main():
    env = parse_env(ENV_PATH)
    token = env.get("HF_TOKEN")
    if not token:
        sys.exit(
            "✗ HF_TOKEN not found in .env.local.\n"
            "  Create a Hugging Face account (no card), then Settings → Access "
            "Tokens → New token (role: write), and add HF_TOKEN=hf_... to .env.local."
        )

    missing = [k for k in AI_KEYS if not env.get(k)]
    if missing:
        sys.exit(f"✗ Missing required key(s) in .env.local: {', '.join(missing)}")

    turn_missing = [k for k in TURN_KEYS if not env.get(k)]
    if turn_missing:
        print(
            f"⚠ TURN not fully set ({', '.join(turn_missing)}). The Space will deploy, "
            "but audio will likely fail until you add your Metered creds and re-run."
        )

    try:
        from huggingface_hub import HfApi
    except ImportError:
        sys.exit("✗ huggingface_hub not installed. Run: .venv/bin/pip install huggingface_hub")

    api = HfApi(token=token)
    username = api.whoami()["name"]
    repo_id = f"{username}/{SPACE_NAME}"
    space_host = f"{username}-{SPACE_NAME}".lower().replace("_", "-")
    space_url = f"https://{space_host}.hf.space"

    print(f"→ Creating/updating Space {repo_id} (public · docker)…")
    api.create_repo(
        repo_id=repo_id,
        repo_type="space",
        space_sdk="docker",
        exist_ok=True,
        private=False,
    )

    # The Space needs a README with Docker frontmatter (app_port matches the
    # Dockerfile's EXPOSE/PORT = 8080).
    readme = (
        "---\n"
        "title: Lobbyee Voice\n"
        "emoji: 🎙️\n"
        "colorFrom: indigo\n"
        "colorTo: gray\n"
        "sdk: docker\n"
        "app_port: 8080\n"
        "pinned: false\n"
        "---\n\n"
        "Lobbyee voice worker (multi-session). Token-gated — every request is "
        "authorized by the Lobbyee app. Not meant to be used directly.\n"
    )

    print("→ Uploading worker (README, Dockerfile, requirements.txt, lobbyee_bot.py)…")
    api.upload_file(
        path_or_fileobj=readme.encode(),
        path_in_repo="README.md",
        repo_id=repo_id,
        repo_type="space",
    )
    for fname in ("Dockerfile", "requirements.txt", "lobbyee_bot.py"):
        api.upload_file(
            path_or_fileobj=str(WORKER_DIR / fname),
            path_in_repo=fname,
            repo_id=repo_id,
            repo_type="space",
        )

    print("→ Setting Space secrets (values never printed)…")
    api.add_space_secret(repo_id, "LOBBYEE_BASE_URL", APP_URL)
    api.add_space_secret(repo_id, "VOICE_ALLOWED_ORIGINS", APP_URL)
    for k in AI_KEYS + TURN_KEYS:
        if env.get(k):
            api.add_space_secret(repo_id, k, env[k])

    # Write the two Vercel values to a local (gitignored) file rather than print —
    # the TURN creds are client-exposed by design but we keep them out of logs.
    ice = [{"urls": "stun:stun.l.google.com:19302"}]
    if env.get("VOICE_TURN_URLS"):
        ice.append(
            {
                "urls": [u.strip() for u in env["VOICE_TURN_URLS"].split(",") if u.strip()],
                "username": env.get("VOICE_TURN_USERNAME", ""),
                "credential": env.get("VOICE_TURN_CREDENTIAL", ""),
            }
        )
    out = WORKER_DIR / "vercel-voice-env.txt"
    out.write_text(
        "# Paste these into Vercel → Project → Settings → Environment Variables\n"
        "# (Production). Then redeploy the app.\n\n"
        f"NEXT_PUBLIC_PIPECAT_WORKER_URL={space_url}\n\n"
        f"NEXT_PUBLIC_VOICE_ICE_SERVERS={json.dumps(ice)}\n"
    )

    print("\n✅ Deploy triggered — the Space is building (~3–6 min for the first build).")
    print(f"   Build logs:  https://huggingface.co/spaces/{repo_id}")
    print(f"   Worker URL:  {space_url}")
    print(f"   Vercel values written to: {out}")
    print("\nNext: I'll watch the build, health-check the worker, then we set those")
    print("two Vercel vars and you can talk to a guest from anywhere.")


if __name__ == "__main__":
    main()
