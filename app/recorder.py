"""
recorder.py — Real-time microphone capture using sounddevice.

Usage:
    recorder = Recorder()
    recorder.start()
    # ... user speaks ...
    audio_data = recorder.stop()   # returns np.ndarray (float32, mono, 16kHz)
    recorder.save_wav(audio_data, "/tmp/vibe_voice.wav")
"""

import threading
import tempfile
from pathlib import Path

import numpy as np
import sounddevice as sd
import soundfile as sf

SAMPLE_RATE = 16_000  # Hz — Whisper's preferred rate
CHANNELS = 1          # Mono


class Recorder:
    def __init__(self, samplerate: int = SAMPLE_RATE):
        self.samplerate = samplerate
        self._chunks: list[np.ndarray] = []
        self._stream: sd.InputStream | None = None
        self._lock = threading.Lock()
        self.is_recording = False

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def start(self) -> None:
        """Open the mic stream and begin buffering audio."""
        if self.is_recording:
            return

        self._chunks = []
        self.is_recording = True

        self._stream = sd.InputStream(
            samplerate=self.samplerate,
            channels=CHANNELS,
            dtype="float32",
            callback=self._callback,
        )
        self._stream.start()

    def stop(self) -> np.ndarray:
        """
        Stop recording and return the captured audio as a (N,) float32 array.
        Returns an empty array if nothing was recorded.
        """
        if not self.is_recording:
            return np.array([], dtype="float32")

        self.is_recording = False

        if self._stream:
            self._stream.stop()
            self._stream.close()
            self._stream = None

        with self._lock:
            if not self._chunks:
                return np.array([], dtype="float32")
            audio = np.concatenate(self._chunks, axis=0).flatten()

        return audio

    def save_wav(self, audio: np.ndarray, path: str | Path | None = None) -> Path:
        """
        Write audio to a WAV file. If path is None, a temp file is created.
        Returns the Path to the written file.
        """
        if path is None:
            tmp = tempfile.NamedTemporaryFile(
                suffix=".wav", prefix="vibe_", delete=False
            )
            path = Path(tmp.name)
            tmp.close()

        path = Path(path)
        sf.write(str(path), audio, self.samplerate)
        return path

    def duration_seconds(self) -> float:
        """Return the number of seconds captured so far."""
        with self._lock:
            total_samples = sum(len(c) for c in self._chunks)
        return total_samples / self.samplerate

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _callback(
        self,
        indata: np.ndarray,
        frames: int,
        time,
        status: sd.CallbackFlags,
    ) -> None:
        if status:
            # Log but don't raise — keeps the stream alive
            print(f"[recorder] sounddevice status: {status}")
        with self._lock:
            self._chunks.append(indata.copy())
