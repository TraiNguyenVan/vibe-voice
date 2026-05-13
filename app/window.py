"""
window.py — PyQt6 floating push-to-talk widget for Vibe Voice.

Design:
  • Frameless, always-on-top, ~320×160px
  • Drag anywhere to reposition
  • Hold the mic button (or Ctrl+Space) to record
  • Release → transcribe → auto-paste
  • Status pill shows: Idle / Recording / Transcribing / Done / Error

States:
  IDLE → (hold button) → RECORDING → (release) → TRANSCRIBING → IDLE
"""

import threading
from pathlib import Path

from PyQt6.QtCore import (
    QEasingCurve,
    QPoint,
    QPropertyAnimation,
    QSize,
    Qt,
    QThread,
    QTimer,
    pyqtSignal,
)
from PyQt6.QtGui import QColor, QFont, QIcon, QPainter, QPen, QShortcut, QKeySequence
from PyQt6.QtWidgets import (
    QApplication,
    QGraphicsDropShadowEffect,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QVBoxLayout,
    QWidget,
)

from app.paster import paste_text
from app.recorder import Recorder
from app.transcriber import Transcriber

# ---------------------------------------------------------------------------
# Colour / style constants
# ---------------------------------------------------------------------------
BG_COLOR = "#0f0f13"
SURFACE_COLOR = "#1a1a24"
ACCENT_COLOR = "#7c6af7"          # Purple — idle mic button
RECORD_COLOR = "#e05555"          # Red — recording
SUCCESS_COLOR = "#4caf80"         # Green — done
ERROR_COLOR = "#e07755"           # Orange — error
TEXT_PRIMARY = "#e8e8f0"
TEXT_MUTED = "#666680"

WINDOW_W, WINDOW_H = 340, 170


# ---------------------------------------------------------------------------
# Worker thread: runs transcription off the main thread
# ---------------------------------------------------------------------------
class TranscribeWorker(QThread):
    finished = pyqtSignal(str)          # emits transcript
    error = pyqtSignal(str)             # emits error message

    def __init__(self, transcriber: Transcriber, audio_path: Path):
        super().__init__()
        self._transcriber = transcriber
        self._audio_path = audio_path

    def run(self):
        try:
            text = self._transcriber.transcribe(self._audio_path)
            self.finished.emit(text)
        except Exception as exc:
            self.error.emit(str(exc))


# ---------------------------------------------------------------------------
# Pulsing mic button
# ---------------------------------------------------------------------------
class MicButton(QPushButton):
    """Round button that pulses red while recording."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setFixedSize(72, 72)
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        self._recording = False
        self._pulse_opacity = 1.0
        self._pulse_growing = False
        self._pulse_timer = QTimer(self)
        self._pulse_timer.timeout.connect(self._tick_pulse)
        self._apply_idle_style()

    # -- Public --

    def set_recording(self, active: bool):
        self._recording = active
        if active:
            self._pulse_timer.start(30)
            self._apply_record_style()
        else:
            self._pulse_timer.stop()
            self._apply_idle_style()

    # -- Internal --

    def _tick_pulse(self):
        step = 0.04
        if self._pulse_growing:
            self._pulse_opacity = min(1.0, self._pulse_opacity + step)
            if self._pulse_opacity >= 1.0:
                self._pulse_growing = False
        else:
            self._pulse_opacity = max(0.4, self._pulse_opacity - step)
            if self._pulse_opacity <= 0.4:
                self._pulse_growing = True
        self.update()

    def paintEvent(self, event):  # noqa: N802
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)

        # Outer glow ring when recording
        if self._recording:
            color = QColor(RECORD_COLOR)
            color.setAlphaF(self._pulse_opacity * 0.35)
            painter.setBrush(color)
            painter.setPen(Qt.PenStyle.NoPen)
            painter.drawEllipse(2, 2, 68, 68)

        # Inner circle
        base = QColor(RECORD_COLOR if self._recording else ACCENT_COLOR)
        painter.setBrush(base)
        painter.setPen(Qt.PenStyle.NoPen)
        painter.drawEllipse(10, 10, 52, 52)

        # Mic icon (simple SVG-style lines)
        painter.setPen(QPen(QColor("#ffffff"), 2.5, Qt.PenStyle.SolidLine,
                            Qt.PenCapStyle.RoundCap))
        cx, cy = 36, 36
        # Body
        painter.drawRoundedRect(cx - 6, cy - 12, 12, 18, 6, 6)
        # Stand arc approximation
        painter.drawArc(cx - 10, cy + 2, 20, 14, 0, -180 * 16)
        # Stem
        painter.drawLine(cx, cy + 16, cx, cy + 22)
        # Base
        painter.drawLine(cx - 6, cy + 22, cx + 6, cy + 22)

    def _apply_idle_style(self):
        self.setStyleSheet("QPushButton { border: none; background: transparent; }")

    def _apply_record_style(self):
        self.setStyleSheet("QPushButton { border: none; background: transparent; }")


# ---------------------------------------------------------------------------
# Main floating window
# ---------------------------------------------------------------------------
class VibeVoiceWindow(QWidget):
    def __init__(self, transcriber: Transcriber):
        super().__init__()
        self._transcriber = transcriber
        self._recorder = Recorder()
        self._drag_pos: QPoint | None = None
        self._worker: TranscribeWorker | None = None
        self._last_transcript = ""

        self._build_ui()
        self._apply_global_style()
        self._setup_shadow()
        self._setup_shortcut()

    # ------------------------------------------------------------------
    # UI construction
    # ------------------------------------------------------------------

    def _build_ui(self):
        self.setWindowFlags(
            Qt.WindowType.FramelessWindowHint
            | Qt.WindowType.WindowStaysOnTopHint
            | Qt.WindowType.Tool          # No taskbar entry
        )
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        self.setFixedSize(WINDOW_W, WINDOW_H)

        # ── Root container (gives rounded corners + bg) ──
        self._container = QWidget(self)
        self._container.setObjectName("container")
        self._container.setGeometry(0, 0, WINDOW_W, WINDOW_H)

        root = QVBoxLayout(self._container)
        root.setContentsMargins(20, 16, 20, 16)
        root.setSpacing(10)

        # ── Top row: app name + close button ──
        top = QHBoxLayout()
        top.setSpacing(0)

        app_label = QLabel("🎙 Vibe Voice")
        app_label.setObjectName("appLabel")

        close_btn = QPushButton("✕")
        close_btn.setObjectName("closeBtn")
        close_btn.setFixedSize(24, 24)
        close_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        close_btn.clicked.connect(self.close)

        top.addWidget(app_label)
        top.addStretch()
        top.addWidget(close_btn)
        root.addLayout(top)

        # ── Middle row: mic button + status ──
        mid = QHBoxLayout()
        mid.setSpacing(16)

        self._mic_btn = MicButton()
        self._mic_btn.pressed.connect(self._on_record_start)
        self._mic_btn.released.connect(self._on_record_stop)

        right = QVBoxLayout()
        right.setSpacing(6)

        self._status_label = QLabel("Hold to record")
        self._status_label.setObjectName("statusLabel")

        self._hint_label = QLabel("Ctrl+Space  ·  drag to move")
        self._hint_label.setObjectName("hintLabel")

        self._transcript_label = QLabel("")
        self._transcript_label.setObjectName("transcriptLabel")
        self._transcript_label.setWordWrap(True)
        self._transcript_label.setMaximumWidth(210)

        right.addWidget(self._status_label)
        right.addWidget(self._hint_label)
        right.addWidget(self._transcript_label)
        right.addStretch()

        mid.addWidget(self._mic_btn, alignment=Qt.AlignmentFlag.AlignTop)
        mid.addLayout(right)
        root.addLayout(mid)

    def _apply_global_style(self):
        self._container.setStyleSheet(f"""
            QWidget#container {{
                background-color: {BG_COLOR};
                border-radius: 18px;
                border: 1px solid #2a2a38;
            }}
            QLabel#appLabel {{
                color: {TEXT_PRIMARY};
                font-size: 13px;
                font-weight: 600;
                font-family: 'Inter', 'Segoe UI', sans-serif;
            }}
            QPushButton#closeBtn {{
                color: {TEXT_MUTED};
                background: transparent;
                border: none;
                font-size: 13px;
                border-radius: 12px;
            }}
            QPushButton#closeBtn:hover {{
                color: {TEXT_PRIMARY};
                background: #2a2a38;
            }}
            QLabel#statusLabel {{
                color: {TEXT_PRIMARY};
                font-size: 14px;
                font-weight: 600;
                font-family: 'Inter', 'Segoe UI', sans-serif;
            }}
            QLabel#hintLabel {{
                color: {TEXT_MUTED};
                font-size: 11px;
                font-family: 'Inter', 'Segoe UI', sans-serif;
            }}
            QLabel#transcriptLabel {{
                color: {ACCENT_COLOR};
                font-size: 12px;
                font-style: italic;
                font-family: 'Inter', 'Segoe UI', sans-serif;
            }}
        """)

    def _setup_shadow(self):
        shadow = QGraphicsDropShadowEffect(self)
        shadow.setBlurRadius(40)
        shadow.setOffset(0, 8)
        shadow.setColor(QColor(0, 0, 0, 140))
        self._container.setGraphicsEffect(shadow)

    def _setup_shortcut(self):
        self._shortcut = QShortcut(QKeySequence("Ctrl+Space"), self)
        self._shortcut.activated.connect(self._toggle_recording)
        self._recording_via_shortcut = False

    # ------------------------------------------------------------------
    # Recording flow
    # ------------------------------------------------------------------

    def _on_record_start(self):
        if self._recorder.is_recording:
            return
        self._recorder.start()
        self._mic_btn.set_recording(True)
        self._set_status("Recording…", RECORD_COLOR)
        self._transcript_label.setText("")

    def _on_record_stop(self):
        if not self._recorder.is_recording:
            return
        audio = self._recorder.stop()
        self._mic_btn.set_recording(False)

        # Guard: too short → skip
        duration = len(audio) / 16_000
        if duration < 0.4:
            self._set_status("Too short — try again", ERROR_COLOR)
            QTimer.singleShot(2000, lambda: self._set_status("Hold to record", TEXT_PRIMARY))
            return

        # Save & transcribe
        self._set_status("Transcribing…", ACCENT_COLOR)
        audio_path = self._recorder.save_wav(audio)
        self._worker = TranscribeWorker(self._transcriber, audio_path)
        self._worker.finished.connect(self._on_transcript_ready)
        self._worker.error.connect(self._on_transcript_error)
        self._worker.start()

    def _toggle_recording(self):
        """Ctrl+Space toggles recording on/off."""
        if self._recorder.is_recording:
            self._on_record_stop()
            self._recording_via_shortcut = False
        else:
            self._on_record_start()
            self._recording_via_shortcut = True

    # ------------------------------------------------------------------
    # Transcript callbacks (from worker thread → main thread via signal)
    # ------------------------------------------------------------------

    def _on_transcript_ready(self, text: str):
        if not text:
            self._set_status("Nothing detected", TEXT_MUTED)
            QTimer.singleShot(2000, lambda: self._set_status("Hold to record", TEXT_PRIMARY))
            return

        self._last_transcript = text
        preview = text if len(text) <= 60 else text[:57] + "…"
        self._transcript_label.setText(f'"{preview}"')
        self._set_status("Pasting…", SUCCESS_COLOR)

        # Paste in a separate thread so Qt doesn't block
        threading.Thread(target=self._do_paste, args=(text,), daemon=True).start()

    def _on_transcript_error(self, msg: str):
        self._set_status(f"Error: {msg[:50]}", ERROR_COLOR)
        QTimer.singleShot(3000, lambda: self._set_status("Hold to record", TEXT_PRIMARY))

    def _do_paste(self, text: str):
        result = paste_text(
            text,
            window_hide_fn=self._temporarily_lower,
            delay_ms=350,
        )
        if result["auto_paste"]:
            self._set_status("✓ Pasted!", SUCCESS_COLOR)
        elif result["clipboard"]:
            self._set_status("📋 Copied — press Ctrl+V", ACCENT_COLOR)
        else:
            self._set_status("⚠ Copy failed", ERROR_COLOR)

        QTimer.singleShot(3000, lambda: self._set_status("Hold to record", TEXT_PRIMARY))

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _set_status(self, text: str, color: str = TEXT_PRIMARY):
        # Thread-safe via QTimer (queued connection)
        QTimer.singleShot(0, lambda: (
            self._status_label.setText(text),
            self._status_label.setStyleSheet(
                f"color: {color}; font-size: 14px; font-weight: 600;"
            ),
        ))

    def _temporarily_lower(self):
        """Lower the window so focus returns to the previous app."""
        self.lower()

    # ------------------------------------------------------------------
    # Drag to reposition (frameless window)
    # ------------------------------------------------------------------

    def mousePressEvent(self, event):  # noqa: N802
        if event.button() == Qt.MouseButton.LeftButton:
            self._drag_pos = event.globalPosition().toPoint() - self.frameGeometry().topLeft()

    def mouseMoveEvent(self, event):  # noqa: N802
        if self._drag_pos and event.buttons() & Qt.MouseButton.LeftButton:
            self.move(event.globalPosition().toPoint() - self._drag_pos)

    def mouseReleaseEvent(self, event):  # noqa: N802
        self._drag_pos = None
