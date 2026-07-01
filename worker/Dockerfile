# Lobbyee voice worker — multi-session production image.
# Build context is the WORKER dir: `docker build -t lobbyee-voice worker/`
# (fly deploy from worker/ does this for you).
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8080

WORKDIR /app

# System libs for OpenCV (cv2): Pipecat's SmallWebRTC transport imports cv2 at
# module load even for audio-only use, and cv2 dynamically links X11/GL/glib
# shared objects that aren't in python:3.12-slim (libxcb.so.1 etc.). Without
# these the bot() task crashes on import after the WebRTC answer is sent — the
# browser shows "connected" but no audio flows. These are runtime .so's only.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 libxcb1 libsm6 libxext6 libxrender1 \
    && rm -rf /var/lib/apt/lists/*

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
