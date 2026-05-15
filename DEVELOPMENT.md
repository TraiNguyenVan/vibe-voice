# Vibe Voice - Development Guideline

Welcome to the development guide for **Vibe Voice**, a push-to-talk speech-to-text widget tailored for Linux/Wayland environments. This document outlines the core architecture, workflow, and critical rules to keep development smooth and simple.

---

## 1. Architecture & Tech Stack

Vibe Voice is built with simplicity and performance in mind. It acts as an always-on-top, transparent widget that listens for a global hotkey, records audio, transcribes it via Groq API, and pastes it into the focused window.

- **Frontend**: Vanilla HTML, CSS, and JavaScript. **No bundler** (no Vite, Webpack, etc.) is used. Files are served directly.
- **Backend**: Rust (via Tauri 2 core). Handles low-level system interactions (audio recording, clipboard, key injection).
- **Audio Processing**: `parec` (pulseaudio-utils) for recording.
- **Text Injection**: `wl-copy` for clipboard, `ydotool` for triggering paste actions on Wayland.
- **API**: Groq Whisper model for lightning-fast speech-to-text.

---

## 2. Environment Setup

Ensure you have the following system dependencies installed:
- **Rust / Cargo**
- **Node.js / pnpm** (for managing Tauri CLI)
- **parec** (`pulseaudio-utils` or pipewire equivalent)
- **wl-copy** (`wl-clipboard`)
- **ydotool** & **ydotoold** (Ensure the daemon is running and your user is in the `input` group)

**Environment Variables:**
Create a `.env` file in the project root:
```env
GROQ_API_KEY=gsk_your_api_key_here
```

---

## 3. Running & Building

To run the application in development mode with hot-reloading (for both Rust and Frontend):

```bash
pnpm run dev
# or use the provided script
./run.sh
```

---

## 4. Frontend Rules (The UI)

Since we are **not using a bundler**, you must adhere to the following rules when working in the `src/` directory:

- **No ES Modules**: Do not use `<script type="module">` in `index.html`. Use standard `<script defer src="main.js"></script>`.
- **Tauri Globals**: All Tauri APIs must be accessed via the `window.__TAURI__` global object. 
  - *Example*: `const { invoke } = window.__TAURI__.core;`
  - *Never* import from `@tauri-apps/api/...` directly in `main.js`, as it will cause the script to crash.
- **Keep it Lightweight**: Write clean, vanilla DOM manipulation and standard CSS. Use CSS variables for easy theming.

---

## 5. Backend Rules (Rust & Tauri)

The Rust backend handles everything the browser engine cannot natively do on Wayland.

- **Capabilities are Mandatory**: Window operations (close, hide, show) will silently fail without explicit permissions. Always ensure `src-tauri/capabilities/default.json` is updated if you need new Tauri API features.
- **Audio Recording**: Do not use `navigator.mediaDevices.getUserMedia()` in the frontend (WebKitGTK blocks it on Wayland). Audio is handled exclusively in Rust via `std::process::Command` calling `parec`.
- **Tauri Commands**: Keep your Rust commands simple and return `Result<String, String>` to easily handle errors in the frontend.

---

## 6. Critical Wayland Gotchas

Developing desktop widgets for Wayland (especially Hyprland) comes with unique quirks:

1. **Hyprland Window Rules**: To remove the default gray box/shadows from the transparent widget, users must add these to their `hyprland.conf`:
   ```conf
   windowrulev2 = noblur,   class:^(vibe-voice)$
   windowrulev2 = noshadow, class:^(vibe-voice)$
   windowrulev2 = pin,      class:^(vibe-voice)$
   windowrulev2 = float,    class:^(vibe-voice)$
   ```
2. **Key Repeat Issues**: When handling global PTT (Push-to-Talk) hotkeys, key-repeat will fire multiple `keydown` events. Always check for `!event.repeat` in JS or use a low-level evdev thread in Rust to prevent spamming the recording start function.
3. **Auto-Pasting Mechanics**: To paste text back to the previously active window, the flow must be:
   - `wl-copy` the text to clipboard.
   - Hide the widget (`window.hide()`) so the previous window regains focus.
   - Wait ~300ms for the compositor to apply focus.
   - Inject `Ctrl+V` using `ydotool`.
   - Restore the widget (`window.show()`).
   
   > **RPM builds:** `ydotool` requires the `YDOTOOL_SOCKET` env var to find the daemon. When launched from a `.desktop` file this var is typically missing. The `find_ydotool_socket()` helper in `lib.rs` auto-discovers the socket via `/proc` scanning + common path probing.
4. **Transparency**: Tauri 2 does not use `tauri::Color`. To achieve a transparent window, ensure `"transparent": true` is set in `tauri.conf.json` and use `background: transparent;` in your `style.css`.

---

## 7. Workflow Summary

1. **Plan**: Identify if the feature requires System UI (Rust) or Visual UI (Vanilla JS).
2. **Build**: Write the Rust command in `src/lib.rs` -> Register it -> Call it via `window.__TAURI__.core.invoke` in `main.js`.
3. **Test**: Run `./run.sh` and test locally on your Wayland compositor. Ensure `ydotool` and audio permissions are functioning.
