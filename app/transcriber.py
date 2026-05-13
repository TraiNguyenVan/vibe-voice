"""
transcriber.py — Send a WAV file to Groq's Whisper endpoint.

Uses whisper-large-v3-turbo: fastest model, great EN + VI accuracy.
Language is left unset (auto-detect).
"""

from pathlib import Path

from groq import Groq

MODEL = "whisper-large-v3-turbo"


class Transcriber:
    def __init__(self, api_key: str):
        self._client = Groq(api_key=api_key)

    def transcribe(self, audio_path: str | Path) -> str:
        """
        Upload an audio file to Groq and return the transcript string.
        Raises on API errors — caller should handle.
        """
        audio_path = Path(audio_path)
        if not audio_path.exists():
            raise FileNotFoundError(f"Audio file not found: {audio_path}")

        with open(audio_path, "rb") as f:
            response = self._client.audio.transcriptions.create(
                file=(audio_path.name, f),
                model=MODEL,
                response_format="text",
                # No 'language' param → Whisper auto-detects (works well for EN + VI)
            )

        # response_format="text" returns a plain string
        return str(response).strip()
