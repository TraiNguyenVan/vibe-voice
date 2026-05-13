"""
paster.py — Copy text to Wayland clipboard and auto-paste into the focused window.

Strategy (Wayland):
  1. wl-copy  → write text to Wayland clipboard
  2. ydotool key ctrl+v  → inject Ctrl+V at evdev level (works without X11)
  3. If ydotool is not installed → return False so the caller can show a toast.

Prerequisites (install once):
  sudo pacman -S wl-clipboard ydotool      # Arch
  sudo apt install wl-clipboard ydotool    # Debian/Ubuntu
  sudo systemctl enable --now ydotool      # start the ydotoold daemon
  sudo usermod -aG input $USER             # add self to input group, then re-login
"""

import shutil
import subprocess
import time


def _is_available(cmd: str) -> bool:
    return shutil.which(cmd) is not None


def copy_to_clipboard(text: str) -> bool:
    """Write text to the Wayland clipboard via wl-copy. Returns True on success."""
    if not _is_available("wl-copy"):
        return False
    try:
        subprocess.run(
            ["wl-copy", text],
            check=True,
            timeout=3,
        )
        return True
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError):
        return False


def simulate_paste(delay_ms: int = 300) -> bool:
    """
    Simulate Ctrl+V via ydotool after a short delay so the previous window
    can regain focus. Returns True if ydotool succeeded.
    """
    if not _is_available("ydotool"):
        return False
    try:
        time.sleep(delay_ms / 1000)
        subprocess.run(
            ["ydotool", "key", "29:1", "47:1", "47:0", "29:0"],
            # 29 = Left Ctrl, 47 = V  (evdev key codes)
            check=True,
            timeout=3,
        )
        return True
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError):
        return False


def paste_text(text: str, window_hide_fn=None, delay_ms: int = 350) -> dict:
    """
    Full paste flow:
      1. Copy text to Wayland clipboard.
      2. Optionally hide/minimize our window (so focus returns to previous app).
      3. Wait delay_ms then simulate Ctrl+V via ydotool.

    Returns a dict with keys:
      - 'clipboard'  (bool)  — text was written to clipboard
      - 'auto_paste' (bool)  — Ctrl+V was simulated successfully
      - 'text'       (str)   — the transcript

    If auto_paste is False the caller should show a "Copied! Press Ctrl+V" toast.
    """
    result = {"clipboard": False, "auto_paste": False, "text": text}

    # Step 1: clipboard
    result["clipboard"] = copy_to_clipboard(text)
    if not result["clipboard"]:
        return result

    # Step 2: hide window so focus returns to previous app
    if window_hide_fn is not None:
        window_hide_fn()

    # Step 3: simulate paste
    result["auto_paste"] = simulate_paste(delay_ms=delay_ms)

    return result
