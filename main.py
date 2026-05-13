"""
main.py — Vibe Voice entry point.

Run with:
    python main.py

Requirements (system packages for Wayland auto-paste):
    sudo pacman -S wl-clipboard ydotool
    sudo systemctl enable --now ydotool
    sudo usermod -aG input $USER   # then re-login
"""

import os
import sys
import shutil

from dotenv import load_dotenv
from PyQt6.QtCore import Qt
from PyQt6.QtWidgets import QApplication, QMessageBox

from app.transcriber import Transcriber
from app.window import VibeVoiceWindow


def check_system_deps() -> list[str]:
    """Return a list of missing optional system dependencies."""
    missing = []
    if not shutil.which("wl-copy"):
        missing.append("wl-clipboard  (clipboard support)")
    if not shutil.which("ydotool"):
        missing.append("ydotool  (auto-paste support)")
    return missing


def main():
    # ── Load .env ─────────────────────────────────────────────────────
    load_dotenv()

    api_key = os.getenv("GROQ_API_KEY", "").strip()
    if not api_key:
        print(
            "ERROR: GROQ_API_KEY is not set.\n"
            "  1. Copy .env.example → .env\n"
            "  2. Paste your key from https://console.groq.com/keys"
        )
        sys.exit(1)

    # ── Qt application ─────────────────────────────────────────────────
    # Force Wayland backend (comment out to use XWayland fallback)
    os.environ.setdefault("QT_QPA_PLATFORM", "wayland")

    app = QApplication(sys.argv)
    app.setApplicationName("Vibe Voice")
    app.setQuitOnLastWindowClosed(True)

    # ── Warn about missing system tools (non-fatal) ────────────────────
    missing = check_system_deps()
    if missing:
        tools = "\n• ".join(missing)
        print(
            f"[vibe-voice] Optional system tools not found:\n• {tools}\n"
            "Auto-paste will fall back to clipboard-only mode.\n"
            "Install with:  sudo pacman -S wl-clipboard ydotool"
        )

    # ── Build & show window ─────────────────────────────────────────────
    transcriber = Transcriber(api_key=api_key)
    window = VibeVoiceWindow(transcriber=transcriber)

    # Position: bottom-right quadrant of primary screen
    screen = app.primaryScreen().availableGeometry()
    window.move(
        screen.right() - window.width() - 40,
        screen.bottom() - window.height() - 60,
    )

    window.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
