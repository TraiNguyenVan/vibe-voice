# Vibe Voice 🎙

A push-to-talk speech-to-text widget for Linux/Wayland. Hold a button, speak, release — transcript goes to your clipboard.

**Stack:** Tauri 2 + Rust + vanilla JS — no bundler.

---

## Quick Install

### Fedora (RPM)

```bash
# 1. Install dependencies and start the daemon
bash ydotool-setup.sh

# 2. Install the app
sudo dnf install ./vibe-voice-*.x86_64.rpm
```

Dependencies: `parec` (pulseaudio-utils), `wl-clipboard`, `ydotool`

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
| Release | Audio sent to Groq → transcript copied to clipboard → tray icon flashes green |
| **Ctrl+V** | Paste the transcript wherever you want |
| Click tray icon | Show/hide the widget |

> The window stays hidden during recording — only the tray icon indicates state.

---

## Building from Source

```bash
pnpm install
pnpm tauri build
```

Output: `src-tauri/target/release/bundle/rpm/`

---

## Requirements

| Tool | Package |
|---|---|
| `parec` | `pulseaudio-utils` |
| `wl-copy` | `wl-clipboard` |
| `ydotool` | `ydotool` (+ `ydotoold` daemon running) |
| `pnpm` | Node.js package manager |
| Rust/Cargo | rustup or distro package |
