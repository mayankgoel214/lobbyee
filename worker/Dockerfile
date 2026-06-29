# Lobbyee voice worker — multi-session production image.
# Build context is the WORKER dir: `docker build -t lobbyee-voice worker/`
# (fly deploy from worker/ does this for you).
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8080

WORKDIR /app

# Deps first for layer caching. aiortc/av/onnxruntime ship manylinux wheels, so
# no build toolchain is needed on slim. ffmpeg libs come bundled in the av wheel.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# App code (just the worker — it holds no app/DB code).
COPY . .

EXPOSE 8080

# serve() (multi-session) runs when VOICE_SESSION_TOKEN is unset — which it is in
# production; each browser brings its own token.
CMD ["python", "lobbyee_bot.py"]
