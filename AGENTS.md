# AGENTS.md — Vibe Voice

Project-specific knowledge for AI agents working on this codebase.

---

## What This Is

A Tauri 2 desktop widget for push-to-talk speech-to-text on Linux/Wayland and Windows.
- Stack: Rust backend + vanilla HTML/JS frontend (no bundler)
- Window: 340px wide, auto-adjusting height (fits contents, defaults to ~160px in idle), always-on-top, transparent, no decorations

---

## Project Structure

```
vibe-voice/
├── src/                    # Frontend (served directly, no bundler)
│   ├── index.html
│   ├── main.js
│   ├── style.css
│   └── logo.png            # TUI-style app logo (16x16px)
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
├── ydotool-setup.sh        # One-shot ydotool/daemon installer for Fedora
├── design.md               # UI design guidelines (font, palette, elements)
└── package.json
```

---

## Running

```bash
./run.sh          # same as: pnpm tauri dev
pnpm run dev      # alias
```

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

### 3. WebKitGTK Blocks Microphone (Linux) / CPAL Backend (Windows)

`navigator.mediaDevices.getUserMedia()` is **denied** by WebKitGTK on Wayland.
- **Linux:** Record audio in Rust using a `parec` subprocess (requires `pulseaudio-utils`).
  `start_recording` spawns `parec` writing to `/tmp/vibe-voice-rec.wav`.
- **Windows:** Spawns a `cpal` audio input stream capturing from the default recording device, writing raw samples to `Temp/vibe-voice-rec.wav` via `hound`.

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

For keyboard PTT (custom combo like Ctrl+Space), `keydown` fires on every key-repeat tick.
**Fix:** Check `!e.repeat` and verify if the custom modifier and trigger keys match:
```js
window.addEventListener('keydown', e => {
  if (isLocalTriggerKey(e) && isLocalModifierPressed(e) && !e.repeat) {
    e.preventDefault();
    startRecording();
  }
});
window.addEventListener('keyup', e => {
  if ((isLocalTriggerKey(e) || isLocalModifierKey(e)) && isRecording) {
    e.preventDefault();
    stopAndTranscribe();
  }
});
```

### 6. Auto-paste / Simulating Keyboard Events

- **Linux:** Types the transcript character-by-character using `ydotool type --file -` with piped stdin.
  1. `wl-copy` text to clipboard (safety net).
  2. `window.hide()` to restore focus to the previous window.
  3. Sleep 300ms for compositor to refocus.
  4. Type via ydotool.
- **Windows:** Uses FFI clipboard copy and simulates paste via `SendInput` (sending Ctrl+V).
  1. Copy text to Unicode clipboard (`CF_UNICODETEXT`).
  2. `window.hide()`.
  3. Sleep 300ms.
  4. Send control-V down/up keyboard inputs.

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
| `start_recording` | `() → Result<(), String>` | Spawns `parec` (Linux) or builds `cpal` stream (Windows), writes to temp WAV |
| `stop_transcribe` | `(api_key?: String) → Result<String, String>` | Stops recording, sends WAV to Groq, returns transcript |
| `paste_text` | `(text: String, auto_type: bool, key_hold: u64, window: WebviewWindow) → Result<bool, String>` | Linux: wl-copy + hide + ydotool. Windows: clipboard + hide + Ctrl+V |
| `set_tray_recording` | `(recording: bool) → Result<(), String>` | Swaps tray icon between idle/recording |
| `flash_tray_done` | `() → Result<(), String>` | Shows green done icon for 2s then reverts to idle |
| `save_hotkeys` | `(modifier: String, trigger: String) → Result<(), String>` | Syncs custom PTT hotkey settings to Rust backend |

---

## Workflow Summary

1. **Plan**: Identify if the feature requires System UI (Rust) or Visual UI (Vanilla JS)
2. **Build**: Write the Rust command in `src/lib.rs` → Register it → Call it via `window.__TAURI__.core.invoke` in `main.js`
3. **Test**: Run `./run.sh` and test locally on your Wayland compositor or Windows target

---

## Releasing

```bash
git tag v0.2.0
git push --tags
```

Pushing a tag `v*` triggers `.github/workflows/release.yml` which builds `.deb` + `.rpm` + Windows setup executables and publishes them to GitHub Releases.
