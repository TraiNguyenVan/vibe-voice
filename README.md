# Vibe Voice

> A push-to-talk speech-to-text widget for Linux/Wayland. Hold a button, speak, release — transcript lands in your active window.

[![Release](https://img.shields.io/github/v/release/TraiNguyenVan/vibe-voice?style=flat&label=release)](https://github.com/TraiNguyenVan/vibe-voice/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/TraiNguyenVan/vibe-voice/release.yml?style=flat&label=build)](https://github.com/TraiNguyenVan/vibe-voice/actions)

---

## Features

- **Push-to-talk** — hold a mic button or **Ctrl+Space**, release when done
- **Groq Whisper** — lightning-fast speech-to-text via `whisper-large-v3-turbo`
- **Auto-paste** — transcript is automatically pasted into your previously focused window
- **Tray icon feedback** — red while recording, green flash when done
- **Always-on-top widget** — small, transparent, no decorations, stays out of your way
- **Private API key** — set your own Groq key via the Settings panel, stored in localStorage
- **Global hotkey** — works on any Wayland compositor via evdev (no X11 dependency)
- **Fedora-first** — one-shot setup script included (`ydotool-setup.sh`)

---

## Quick Install

### Fedora (RPM)

```bash
# One-time dependency setup
bash ydotool-setup.sh

# Install the app
sudo dnf install ./vibe-voice-*.x86_64.rpm
```

### Debian / Ubuntu (DEB)

```bash
# Install dependencies
sudo apt install ydotool pulseaudio-utils wl-clipboard

# Start the ydotool daemon
sudo /usr/bin/ydotoold --socket-path=/tmp/.ydotool_socket --socket-own=$(id -u):$(id -g) &

# Install the app
sudo apt install ./vibe-voice_*.deb
```

> **Windows are supported?** No. Vibe Voice is a Linux/Wayland-only project.

---

## First Run

1. Launch **Vibe Voice** from your app menu or run `vibe-voice`
2. Click the ⚙️ Settings button in the titlebar
3. Paste your [Groq API Key](https://console.groq.com/keys)
4. Click **Save** — key persists in browser localStorage

---

## Usage

| Action | Result |
|---|---|
| Hold mic button (or **Ctrl+Space**) | Recording starts, tray icon turns red |
| Release | Audio → Groq Whisper → clipboard → auto-pasted via ydotool |
| Tray icon flashes green | Transcription done and pasted |
| Click tray icon | Show / hide the widget |
| Settings ⚙️ | Change API key |

The widget window stays hidden throughout recording — only the tray icon signals state.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Tauri 2 (Rust)                     │
│                                                      │
│  start_recording  →  parec (audio)                   │
│  stop_transcribe  →  Groq API → transcript           │
│  paste_text       →  wl-copy + ydotool type --file -        │
│  flash_tray_done  →  tray icon swap (2s)             │
│  evdev listener   →  global Ctrl+Space hotkey         │
└──────────────┬──────────────────────┬────────────────┘
               │ invoke()             │ emit events
               ▼                      ▼
┌──────────────────────────────┐
│   Frontend (vanilla JS)      │
│   src/                       │
│   ├── index.html             │
│   ├── main.js                │
│   └── style.css              │
└──────────────────────────────┘
```

---

## Project Structure

```
vibe-voice/
├── src/                        # Frontend (no bundler)
│   ├── index.html
│   ├── main.js
│   └── style.css
├── src-tauri/
│   ├── src/
│   │   ├── lib.rs              # All Tauri commands + app entry
│   │   └── main.rs             # Delegates to lib.rs run()
│   ├── icons/                  # App + tray icons
│   ├── capabilities/
│   │   └── default.json        # Tauri 2 window permissions
│   ├── Cargo.toml
│   └── tauri.conf.json
├── LICENSE                   # MIT license
├── .github/workflows/
│   └── release.yml             # CI: build deb + rpm on tag push
├── ydotool-setup.sh            # Fedora one-shot daemon setup
├── run.sh                      # pnpm tauri dev alias
├── .env                        # GROQ_API_KEY (gitignored)
├── AGENTS.md                   # AI agent instructions (gotchas, commands)
└── package.json
```

---

## Building from Source

```bash
pnpm install
pnpm tauri build
```

Output:

| Format | Path |
|---|---|
| `.deb` | `src-tauri/target/release/bundle/deb/` |
| `.rpm` | `src-tauri/target/release/bundle/rpm/` |

### Development

```bash
./run.sh           # pnpm tauri dev
pnpm run dev       # alias
```

---

## Requirements

| Tool | Package | Purpose |
|---|---|---|
| `parec` | `pulseaudio-utils` | Audio recording (PipeWire-compatible) |
| `wl-copy` | `wl-clipboard` | Wayland clipboard write |
| `ydotool` | `ydotool` | Types characters into the focused window via evdev |
| `ydotoold` | (daemon) | Background daemon; user needs `input` group |
| `pnpm` | — | Node.js package manager |
| Rust/Cargo | — | Compiling the Tauri backend |

---

## Technical Details

### No Bundler

The frontend is served as static files. Tauri APIs are accessed via `window.__TAURI__` globals — no Vite, no webpack, no `import` from `@tauri-apps/api`.

### Audio Recording

WebKitGTK blocks `getUserMedia()` on Wayland. Audio is recorded via a `parec` subprocess spawned from Rust:

```bash
parec --channels=1 --rate=16000 --format=s16le --file-format=wav /tmp/vibe-voice-rec.wav
```

### Tray Icon States

| State | Icon | Duration |
|---|---|---|
| Idle | Default tray icon | Until recording |
| Recording | Red icon | Recording duration |
| Done | Green icon | 2 seconds, then reverts to idle |

### Auto-paste Flow (Character-by-Character)

1. `wl-copy` writes transcript to Wayland clipboard (safety net)
2. Window hides to return focus to previous app
3. 300ms wait for compositor to refocus
4. `ydotool type --file -` types each character via evdev (piped stdin)
5. Window stays hidden after paste

### Socket Discovery for RPM

When launched from a `.desktop` file, `YDOTOOL_SOCKET` isn't set. The `find_ydotool_socket()` helper in `lib.rs` auto-discovers the socket by:
1. Checking `$YDOTOOL_SOCKET` env var
2. Scanning `/proc/*/cmdline` for `ydotoold --socket-path`
3. Probing common paths (`/tmp/.ydotool_socket`, `/run/user/*/.ydotool_socket`)

---

## License

MIT
