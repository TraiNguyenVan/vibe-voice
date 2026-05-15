# AGENTS.md — Vibe Voice

Project-specific knowledge for AI agents working on this codebase.

---

## What This Is

A Tauri 2 desktop widget for push-to-talk speech-to-text on Linux/Wayland.
- Hold mic button (or Ctrl+Space) → records audio → sends to Groq Whisper → pastes result into focused window
- Stack: Rust backend + vanilla HTML/JS frontend (no bundler)
- Window: 340×160px, always-on-top, transparent, no decorations

---

## Project Structure

```
vibe-voice/
├── src/                    # Frontend (served directly, no bundler)
│   ├── index.html
│   ├── main.js
│   └── style.css
├── src-tauri/
│   ├── src/
│   │   ├── lib.rs          # All Tauri commands + app entry
│   │   └── main.rs         # Delegates to lib.rs run()
│   ├── capabilities/
│   │   └── default.json    # Tauri 2 window permissions (REQUIRED)
│   ├── Cargo.toml
│   └── tauri.conf.json
├── .env                    # GROQ_API_KEY=... (not committed)
├── run.sh                  # ./run.sh → pnpm tauri dev
└── package.json
```

---

## Running

```bash
./run.sh          # same as: pnpm tauri dev
pnpm run dev      # alias
```

Requires: `pnpm`, Rust/Cargo, `parec` (pulseaudio-utils), `wl-clipboard`, `ydotool`

---

## Critical Gotchas

### 1. No Bundler — Use `window.__TAURI__` Globals

The project has **no Vite/webpack**. `src/` is served as static files.
- `tauri.conf.json` must have `"withGlobalTauri": true` under `app`
- `index.html` must NOT use `<script type="module">` — use `<script defer>` instead
- Access Tauri APIs via globals: `window.__TAURI__.core.invoke`, `window.__TAURI__.window.getCurrentWindow()`
- Never `import from '@tauri-apps/api/...'` — it will silently crash the entire script

### 2. Tauri 2 Capabilities File is Mandatory

Window operations (close, hide, show) require explicit permissions in:
`src-tauri/capabilities/default.json`

Without it, `appWindow.close()` and other window calls silently fail.
The window `label` in `tauri.conf.json` must match the `windows` array in capabilities.

### 3. WebKitGTK Blocks Microphone by Default

`navigator.mediaDevices.getUserMedia()` is **denied** by WebKitGTK on Wayland.
**Solution:** Record audio in Rust using `parec` subprocess — no browser mic permission needed.

```
start_recording  → spawns: parec --channels=1 --rate=16000 --format=s16le --file-format=wav /tmp/vibe-voice-rec.wav
stop_transcribe  → kills parec, reads WAV, sends to Groq, returns transcript
```

### 4. Hyprland Transparency / Gray Box

The "blank gray space" below the widget is a WebKitGTK/compositor artifact.
Add to `~/.config/hypr/hyprland.conf`:
```
windowrulev2 = noblur,   class:^(vibe-voice)$
windowrulev2 = noshadow, class:^(vibe-voice)$
windowrulev2 = pin,      class:^(vibe-voice)$
windowrulev2 = float,    class:^(vibe-voice)$
```
Then `hyprctl reload`.

### 5. `keydown` Fires Repeatedly on Hold (key repeat)

For keyboard PTT (Ctrl+Space), `keydown` fires on every key-repeat tick.
**Fix:** Use `!e.repeat` to only trigger on the first press, and stop on `keyup`:
```js
window.addEventListener('keydown', e => {
  if (e.code === 'Space' && e.ctrlKey && !e.repeat) startRecording();
});
window.addEventListener('keyup', e => {
  if ((e.code === 'Space' || e.code === 'ControlLeft') && isRecording) stopAndTranscribe();
});
```

### 6. Auto-paste Requires Window Hide + Delay + Socket Discovery

For ydotool Ctrl+V to land in the previously focused window:
1. `wl-copy` the text first
2. `window.hide()` — gives focus back to previous window
3. Sleep 300ms — compositor needs time to re-focus
4. `ydotool key 29:1 47:1 47:0 29:0` — evdev key codes (29=LCtrl, 47=V)
5. Sleep 150ms then `window.show()` + `window.set_focus()`

ydotool requires the daemon (`ydotoold`) to be running and user in `input` group.

**RPM / Production gotcha:** When launched from a `.desktop` file (e.g. RPM install),
the `YDOTOOL_SOCKET` env var is often missing. ydotool then defaults to
`/run/user/UID/.ydotool_socket`, which won't exist if the daemon was started with
`--socket-path=/tmp/.ydotool_socket`. The `find_ydotool_socket()` helper in `lib.rs`
auto-discovers the socket by: (1) checking `$YDOTOOL_SOCKET`, (2) scanning
`/proc/*/cmdline` for the ydotoold `--socket-path` flag, (3) probing common paths.

### 7. `tauri::Color` Does Not Exist in Tauri 2

`set_background_color(Some(tauri::Color(0,0,0,0)))` will NOT compile.
The API path doesn't exist at the top level in Tauri 2.
Use CSS `background: transparent` + `"transparent": true` in `tauri.conf.json` instead.

### 8. `tauri-plugin-shell` Not Needed

We use `std::process::Command` directly for `parec`, `wl-copy`, `ydotool`.
Do not add `tauri-plugin-shell` unless shell sandboxing is required.

---

## Environment

```bash
# .env (project root)
GROQ_API_KEY=gsk_...
```

Loaded at startup via `dotenvy::from_path()` pointing to the parent of `src-tauri/`.

---

## Tauri Commands (Rust → JS)

| Command | Signature | Description |
|---|---|---|
| `start_recording` | `() → Result<(), String>` | Spawns `parec`, writes to `/tmp/vibe-voice-rec.wav` |
| `stop_transcribe` | `() → Result<String, String>` | Kills parec, sends WAV to Groq, returns transcript |
| `paste_text` | `(text: String, window: WebviewWindow) → Result<bool, String>` | wl-copy + hide + ydotool Ctrl+V + show |

---

## System Dependencies

| Tool | Package | Purpose |
|---|---|---|
| `parec` | `pulseaudio-utils` | Audio recording (PipeWire-pulse compatible) |
| `wl-copy` | `wl-clipboard` | Wayland clipboard write |
| `ydotool` | `ydotool` | Evdev-level key injection for Ctrl+V |
| `ydotoold` | (daemon) | Must be running; user needs `input` group |

```bash
# Check all deps:
which parec wl-copy ydotool
groups | grep input
systemctl --user status ydotoold  # or check if running
```
