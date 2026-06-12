#
# Lobbyee Phase 5 — M0 iPhone voice-feasibility spike (throwaway).
#
# A tiny voice bot: you talk, Deepgram transcribes, Gemini replies in one
# short sentence, Cartesia speaks it back. The ONLY purpose is to answer
# "does real-time voice work on my iPhone as an installed PWA?" before we
# build the real worker. No auth, no persistence, not wired to the app.
#
# Based on the official Pipecat quickstart (BSD), adapted: Daily transport
# dropped (local SmallWebRTC only) and the LLM swapped to Gemini so it reuses
# the keys already in the repo's .env.local.
#
# Run:  cd worker && source .venv/bin/activate && python bot.py
# Then expose to your phone:  ngrok http 7860
#
import os
from pathlib import Path

from dotenv import load_dotenv
from loguru import logger

print("🚀 Starting Lobbyee voice spike...")
print("⏳ Loading models and imports (first run downloads the VAD model)\n")

from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.frames.frames import LLMRunFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.runner.types import RunnerArguments
from pipecat.runner.utils import create_transport
from pipecat.services.cartesia.tts import CartesiaTTSService
from pipecat.services.deepgram.stt import DeepgramSTTService
from pipecat.services.google.llm import GoogleLLMService
from pipecat.transports.base_transport import BaseTransport, TransportParams

# Reuse the repo's existing keys (DEEPGRAM_API_KEY, CARTESIA_API_KEY,
# GEMINI_API_KEY) — no duplication, python-dotenv strips the quotes.
load_dotenv(Path(__file__).resolve().parent.parent / ".env.local", override=True)

logger.info("✅ Imports loaded")


async def run_bot(transport: BaseTransport, runner_args: RunnerArguments):
    stt = DeepgramSTTService(api_key=os.getenv("DEEPGRAM_API_KEY"))

    tts = CartesiaTTSService(
        api_key=os.getenv("CARTESIA_API_KEY"),
        settings=CartesiaTTSService.Settings(
            voice="71a7ad14-091c-4e8e-a314-022ece01c121",  # British Reading Lady
        ),
    )

    llm = GoogleLLMService(
        api_key=os.getenv("GEMINI_API_KEY"),
        settings=GoogleLLMService.Settings(
            model="gemini-2.5-flash",
            system_instruction=(
                "You are a friendly assistant for a quick microphone test. "
                "Greet the user warmly, then keep every reply to ONE short, "
                "natural sentence. This is just a sound check."
            ),
        ),
    )

    context = LLMContext()
    user_aggregator, assistant_aggregator = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(vad_analyzer=SileroVADAnalyzer()),
    )

    pipeline = Pipeline(
        [
            transport.input(),
            stt,
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
    )

    @transport.event_handler("on_client_connected")
    async def on_client_connected(transport, client):
        logger.info("Client connected — kicking off the greeting")
        context.add_message(
            {
                "role": "developer",
                "content": "Say hello, tell the user this is a quick mic test, and ask them to say something.",
            }
        )
        await task.queue_frames([LLMRunFrame()])

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(transport, client):
        logger.info("Client disconnected")
        await task.cancel()

    runner = PipelineRunner(handle_sigint=runner_args.handle_sigint)
    await runner.run(task)


async def bot(runner_args: RunnerArguments):
    """Entry point — local SmallWebRTC only."""
    transport_params = {
        "webrtc": lambda: TransportParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
        ),
    }
    transport = await create_transport(runner_args, transport_params)
    await run_bot(transport, runner_args)


if __name__ == "__main__":
    from pipecat.runner.run import main

    main()
