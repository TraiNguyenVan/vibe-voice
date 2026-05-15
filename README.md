# Vibe Voice

A push-to-talk speech-to-text widget for Linux/Wayland. Hold a button, speak, release — transcript is pasted into your active window.

**Stack:** Tauri 2 + Rust + vanilla JS (no bundler)

---

## Quick Install

### Fedora (RPM)

```bash
# 1. One-time setup: install ydotool, start daemon, add udev rules
bash ydotool-setup.sh

# 2. Install the app
sudo dnf install ./vibe-voice-*.x86_64.rpm
```

### Debian/Ubuntu (DEB)

```bash
# Install dependencies
sudo apt install ydotool pulseaudio-utils wl-clipboard

# Start the ydotoold daemon
sudo /usr/bin/ydotoold --socket-path=/tmp/.ydotool_socket --socket-own=$(id -u):$(id -g) &

# Install the app
sudo apt install ./vibe-voice_*.deb
```

---

## First Run

1. Launch **Vibe Voice** from your app menu or run `vibe-voice`
2. Click the ⚙️ Settings button in the titlebar
3. Paste your [Groq API Key](https://console.groq.com/keys)
4. Click **Save** — key is stored in browser localStorage

---

## Usage

| Action | What happens |
|---|---|
| Hold mic button (or **Ctrl+Space**) | Recording starts — tray icon turns red |
| Release | Audio → Groq Whisper → wl-copy + ydotool Ctrl+V → tray icon flashes green |
| Click tray icon | Show/hide the widget |

The window stays hidden during recording. The tray icon is your only indicator.

---

## Building from Source

```bash
pnpm install
pnpm tauri build
```

Output: `src-tauri/target/release/bundle/deb/` and `rpm/`

---

## Requirements

| Tool | Package | Purpose |
|---|---|---|
| `parec` | `pulseaudio-utils` | Audio recording (PipeWire-compatible) |
| `wl-copy` | `wl-clipboard` | Wayland clipboard |
| `ydotool` | `ydotool` | Key injection for paste |
| `ydotoold` | (daemon) | Must be running; user needs `input` group |
| `pnpm` | — | Node.js package manager |
| Rust/Cargo | — | For building from source |
