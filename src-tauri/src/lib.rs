use std::io::Write;
use std::sync::{Mutex, Arc, atomic::{AtomicBool, Ordering}};
use std::process::Command;
use reqwest::multipart;
use tauri::{
    State, Manager, AppHandle, Emitter,
    tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState},
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    image::Image,
};

pub struct ApiKey(pub String);
pub struct RecordingHandle(pub Mutex<Option<std::process::Child>>);
pub struct TrayHandle(pub Mutex<Option<tauri::tray::TrayIcon>>);

const GROQ_URL: &str = "https://api.groq.com/openai/v1/audio/transcriptions";
const MODEL: &str    = "whisper-large-v3-turbo";
const TMP_WAV: &str  = "/tmp/vibe-voice-rec.wav";

// ── Tauri Commands ──────────────────────────────────────────────────────────

#[tauri::command]
fn start_recording(handle: State<'_, RecordingHandle>) -> Result<(), String> {
    let mut guard = handle.0.lock().unwrap();
    if guard.is_some() { return Ok(()); }

    let _ = std::fs::remove_file(TMP_WAV);

    let child = Command::new("/usr/bin/parec")
        .args(["--channels=1", "--rate=16000", "--format=s16le",
               "--file-format=wav", "--latency-msec=50", TMP_WAV])
        .spawn()
        .map_err(|e| format!("parec failed: {e}"))?;

    *guard = Some(child);
    Ok(())
}

#[tauri::command(rename_all = "snake_case")]
async fn stop_transcribe(
    handle: State<'_, RecordingHandle>,
    env_key: State<'_, ApiKey>,
    api_key: Option<String>,
) -> Result<String, String> {
    {
        let mut guard = handle.0.lock().unwrap();
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    tokio::time::sleep(std::time::Duration::from_millis(200)).await;

    let audio = std::fs::read(TMP_WAV)
        .map_err(|e| format!("read wav: {e}"))?;

    if audio.len() < 1000 {
        return Err("too short".into());
    }

    let effective_key = api_key
        .filter(|k| !k.is_empty())
        .unwrap_or_else(|| env_key.0.clone());

    let part = multipart::Part::bytes(audio)
        .file_name("rec.wav")
        .mime_str("audio/wav")
        .map_err(|e| e.to_string())?;

    let form = multipart::Form::new()
        .text("model", MODEL)
        .text("response_format", "text")
        .part("file", part);

    let resp = reqwest::Client::new()
        .post(GROQ_URL)
        .header("Authorization", format!("Bearer {}", effective_key))
        .multipart(form)
        .send().await
        .map_err(|e| format!("network: {e}"))?;

    let status = resp.status();
    let body   = resp.text().await.map_err(|e| e.to_string())?;

    if !status.is_success() {
        return Err(format!("Groq {status}: {body}"));
    }
    let transcript = body.trim().to_string();
    println!("[vibe-voice] transcript: {transcript}");
    Ok(transcript)
}

/// Discover the ydotoold socket path. The daemon may have been started with
/// a custom `--socket-path`, so the env var `YDOTOOL_SOCKET` isn't always set
/// (especially when the app is launched from a .desktop file / RPM install).
fn find_ydotool_socket() -> Option<String> {
    // 1. Check the environment variable first (set in dev terminal sessions)
    if let Ok(path) = std::env::var("YDOTOOL_SOCKET") {
        if std::path::Path::new(&path).exists() {
            return Some(path);
        }
    }

    // 2. Probe the ydotoold process cmdline for --socket-path
    if let Ok(entries) = std::fs::read_dir("/proc") {
        for entry in entries.flatten() {
            let cmdline_path = entry.path().join("cmdline");
            if let Ok(cmdline) = std::fs::read_to_string(&cmdline_path) {
                if cmdline.contains("ydotoold") {
                    // cmdline uses \0 as separator
                    let parts: Vec<&str> = cmdline.split('\0').collect();
                    for part in &parts {
                        if let Some(sock) = part.strip_prefix("--socket-path=") {
                            if std::path::Path::new(sock).exists() {
                                return Some(sock.to_string());
                            }
                        }
                    }
                    // Also check the next arg after --socket-path
                    for (i, part) in parts.iter().enumerate() {
                        if *part == "--socket-path" {
                            if let Some(sock) = parts.get(i + 1) {
                                if std::path::Path::new(sock).exists() {
                                    return Some(sock.to_string());
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // 3. Common socket locations
    let uid = unsafe { libc::getuid() };
    let candidates = [
        "/tmp/.ydotool_socket".to_string(),
        format!("/run/user/{}/.ydotool_socket", uid),
        "/run/user/1000/.ydotool_socket".to_string(),
    ];
    for path in &candidates {
        if std::path::Path::new(path).exists() {
            return Some(path.clone());
        }
    }

    None
}

fn sanitize_for_typing(text: &str) -> String {
    text.chars()
        .map(|c| match c {
            '\n' | '\r' => ' ',
            c if c.is_control() => ' ',
            other => other,
        })
        .collect()
}

#[tauri::command]
async fn paste_text(text: String, window: tauri::WebviewWindow) -> Result<bool, String> {
    // ── Step 1: Copy text to Wayland clipboard (safety net) ──
    if let Err(e) = Command::new("/usr/bin/wl-copy")
        .arg(&text)
        .status()
    {
        eprintln!("[vibe-voice] wl-copy failed to launch: {e}");
    }

    // ── Step 2: Hide window so previous window regains focus ──
    window.hide().ok();
    std::thread::sleep(std::time::Duration::from_millis(300));

    // ── Step 3: Type transcript character-by-character via ydotool ──
    let sanitized = sanitize_for_typing(&text);
    eprintln!("[vibe-voice] typing {} chars", sanitized.len());

    let mut ydotool_cmd = Command::new("/usr/bin/ydotool");
    ydotool_cmd
        .args(["type", "--key-delay", "1", "--file", "-"])
        .stdin(std::process::Stdio::piped());

    if let Some(socket_path) = find_ydotool_socket() {
        eprintln!("[vibe-voice] using ydotool socket: {socket_path}");
        ydotool_cmd.env("YDOTOOL_SOCKET", &socket_path);
    } else {
        eprintln!("[vibe-voice] WARNING: could not find ydotool socket — typing may fail");
    }

    let ok = match ydotool_cmd.spawn() {
        Ok(mut child) => {
            if let Some(mut stdin) = child.stdin.take() {
                let _ = stdin.write_all(sanitized.as_bytes());
            }
            match child.wait() {
                Ok(status) => status.success(),
                Err(e) => {
                    eprintln!("[vibe-voice] ydotool wait failed: {e}");
                    false
                }
            }
        }
        Err(e) => {
            eprintln!("[vibe-voice] ydotool failed to launch: {e}");
            false
        }
    };

    std::thread::sleep(std::time::Duration::from_millis(150));
    Ok(ok)
}

/// Called by JS to swap the tray icon between idle ↔ recording states.
#[tauri::command]
fn set_tray_recording(
    recording: bool,
    tray_handle: State<'_, TrayHandle>,
    app: AppHandle,
) -> Result<(), String> {
    let guard = tray_handle.0.lock().unwrap();
    if let Some(tray) = guard.as_ref() {
        let icon = load_tray_icon(&app, if recording { "recording" } else { "idle" })?;
        tray.set_icon(Some(icon)).map_err(|e| e.to_string())?;
        tray.set_tooltip(Some(if recording {
            "Vibe Voice — Recording…"
        } else {
            "Vibe Voice — Hold Ctrl+Space to record"
        })).ok();
    }
    Ok(())
}

#[tauri::command]
fn flash_tray_done(
    tray_handle: State<'_, TrayHandle>,
    app: AppHandle,
) -> Result<(), String> {
    let guard = tray_handle.0.lock().unwrap();
    if let Some(tray) = guard.as_ref() {
        let done_icon = load_tray_icon(&app, "done")?;
        tray.set_icon(Some(done_icon.clone())).map_err(|e| e.to_string())?;
        tray.set_tooltip(Some("Vibe Voice — ✓ Copied to clipboard")).ok();
    }
    drop(guard);

    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(2));
        if let Some(tray) = app.state::<TrayHandle>().0.lock().unwrap().as_ref() {
            if let Ok(idle_icon) = load_tray_icon(&app, "idle") {
                tray.set_icon(Some(idle_icon)).ok();
                tray.set_tooltip(Some("Vibe Voice — Hold Ctrl+Space to record")).ok();
            }
        }
    });

    Ok(())
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/// Load a PNG file from the icons directory and convert it into a Tauri Image.
fn load_tray_icon(app: &AppHandle, state: &str) -> Result<Image<'static>, String> {
    let filename = match state {
        "recording" => "tray-recording.png",
        "done" => "tray-done.png",
        _ => "tray-idle.png",
    };

    // During `tauri dev` the resource_dir is the project root; during production it's
    // the bundle resources dir. We try a few candidate paths.
    let candidates = vec![
        // Bundled resources path (production)
        app.path().resource_dir()
            .ok()
            .map(|p| p.join("icons").join(filename)),
        // Fallback: resolve relative to the Cargo manifest dir (dev mode)
        Some(std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("icons")
            .join(filename)),
    ];

    for candidate in candidates.into_iter().flatten() {
        if candidate.exists() {
            return png_to_tauri_image(&candidate);
        }
    }

    // If neither found, return an error so the caller can handle gracefully
    Err(format!("tray icon not found: {filename}"))
}

fn png_to_tauri_image(path: &std::path::Path) -> Result<Image<'static>, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("read icon: {e}"))?;
    let decoder = png::Decoder::new(std::io::Cursor::new(&bytes));
    let mut reader = decoder.read_info().map_err(|e| format!("png decode: {e}"))?;
    let mut buf = vec![0u8; reader.output_buffer_size()];
    let info = reader.next_frame(&mut buf).map_err(|e| format!("png frame: {e}"))?;
    let rgba = buf[..info.buffer_size()].to_vec();
    Ok(Image::new_owned(rgba, info.width, info.height))
}

fn toggle_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            window.hide().ok();
        } else {
            window.show().ok();
            window.set_focus().ok();
        }
    }
}

fn show_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        window.show().ok();
        window.set_focus().ok();
    }
}

// ── Tray Setup ───────────────────────────────────────────────────────────────

fn setup_tray(app: &tauri::App) -> Result<tauri::tray::TrayIcon, Box<dyn std::error::Error>> {
    let record_item = MenuItemBuilder::with_id("record", "🎙 Record now").build(app)?;
    let toggle_item = MenuItemBuilder::with_id("toggle", "Show / Hide").build(app)?;
    let sep         = PredefinedMenuItem::separator(app)?;
    let quit_item   = MenuItemBuilder::with_id("quit", "Quit Vibe Voice").build(app)?;

    let menu = MenuBuilder::new(app)
        .item(&record_item)
        .item(&toggle_item)
        .item(&sep)
        .item(&quit_item)
        .build()?;

    // Try to load the custom icon, fall back gracefully
    let icon = load_tray_icon(&app.handle(), "idle").unwrap_or_else(|e| {
        eprintln!("[vibe-voice] tray icon load failed ({e}), using fallback");
        // 1×1 transparent RGBA pixel
        Image::new_owned(vec![0u8, 0, 0, 0], 1, 1)
    });

    let tray = TrayIconBuilder::new()
        .icon(icon)
        .tooltip("Vibe Voice — Hold Ctrl+Space to record")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            match event.id().as_ref() {
                "record" => {
                    show_window(app);
                    app.emit("global-ptt-start", ()).ok();
                }
                "toggle" => toggle_window(app),
                "quit"   => app.exit(0),
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event {
                toggle_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(tray)
}

// ── Global Hotkey via evdev ──────────────────────────────────────────────────
//
// Reads /dev/input/event* directly — works on any Wayland compositor.
// Requires the user to be in the `input` group (same requirement as ydotoold).
// Uses a 8ms polling loop across all keyboard devices.

fn spawn_global_hotkey_listener(app: AppHandle) {
    std::thread::Builder::new()
        .name("evdev-hotkey".into())
        .spawn(move || {
            use evdev::{Device, EventType, Key};
            use std::os::unix::io::AsRawFd;

            const KEY_LEFTCTRL:  u16 = 29;
            const KEY_RIGHTCTRL: u16 = 97;
            const KEY_SPACE:     u16 = 57;

            // Collect all keyboard devices
            let mut devices: Vec<Device> = Vec::new();

            let dir = match std::fs::read_dir("/dev/input") {
                Err(e) => {
                    eprintln!("[vibe-voice] evdev: cannot read /dev/input: {e}");
                    eprintln!("[vibe-voice] evdev: run: sudo usermod -aG input $USER && re-login");
                    return;
                }
                Ok(d) => d,
            };

            for entry in dir.flatten() {
                let path = entry.path();
                if !path.file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .starts_with("event")
                {
                    continue;
                }

                match Device::open(&path) {
                    Ok(dev) => {
                        if dev.supported_keys().map(|k| {
                            k.contains(Key::KEY_A) && k.contains(Key::KEY_SPACE)
                        }).unwrap_or(false) {
                            devices.push(dev);
                        }
                    }
                    Err(_) => {} // skip unreadable devices silently
                }
            }

            if devices.is_empty() {
                eprintln!("[vibe-voice] evdev: no keyboard devices found — global hotkey disabled");
                eprintln!("[vibe-voice] evdev: ensure you are in the 'input' group");
                return;
            }

            eprintln!("[vibe-voice] evdev: monitoring {} keyboard device(s) for Ctrl+Space", devices.len());

            // Set all devices to non-blocking using raw fd
            for dev in &devices {
                unsafe {
                    libc_set_nonblocking(dev.as_raw_fd());
                }
            }

            let ctrl_held  = Arc::new(AtomicBool::new(false));
            let space_held = Arc::new(AtomicBool::new(false));
            let ptt_active = Arc::new(AtomicBool::new(false));

            loop {
                let mut got_event = false;

                for dev in &mut devices {
                    match dev.fetch_events() {
                        Ok(events) => {
                            for ev in events {
                                if ev.event_type() != EventType::KEY { continue; }

                                let code  = ev.code();
                                let value = ev.value(); // 0=up, 1=down, 2=repeat

                                let is_ctrl  = code == KEY_LEFTCTRL || code == KEY_RIGHTCTRL;
                                let is_space = code == KEY_SPACE;
                                if !is_ctrl && !is_space { continue; }

                                got_event = true;

                                if value == 1 {      // key down
                                    if is_ctrl  { ctrl_held.store(true,  Ordering::Relaxed); }
                                    if is_space { space_held.store(true,  Ordering::Relaxed); }
                                } else if value == 0 { // key up
                                    if is_ctrl  { ctrl_held.store(false, Ordering::Relaxed); }
                                    if is_space { space_held.store(false, Ordering::Relaxed); }
                                } else {
                                    continue; // ignore key repeat
                                }

                                let both_down  = ctrl_held.load(Ordering::Relaxed)
                                              && space_held.load(Ordering::Relaxed);
                                let was_active = ptt_active.load(Ordering::Relaxed);

                                if both_down && !was_active {
                                    ptt_active.store(true, Ordering::Relaxed);
                                    app.emit("global-ptt-start", ()).ok();
                                    eprintln!("[vibe-voice] evdev: Ctrl+Space → PTT start");
                                } else if !both_down && was_active {
                                    ptt_active.store(false, Ordering::Relaxed);
                                    app.emit("global-ptt-stop", ()).ok();
                                    eprintln!("[vibe-voice] evdev: Ctrl+Space released → PTT stop");
                                }
                            }
                        }
                        Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                        Err(_) => {}
                    }
                }

                if !got_event {
                    std::thread::sleep(std::time::Duration::from_millis(8));
                }
            }
        })
        .expect("failed to spawn evdev thread");
}

/// Set a file descriptor to non-blocking mode via `fcntl`.
unsafe fn libc_set_nonblocking(fd: i32) {
    extern "C" {
        fn fcntl(fd: i32, cmd: i32, ...) -> i32;
    }
    const F_GETFL: i32 = 3;
    const F_SETFL: i32 = 4;
    const O_NONBLOCK: i32 = 2048;
    let flags = fcntl(fd, F_GETFL);
    if flags >= 0 {
        fcntl(fd, F_SETFL, flags | O_NONBLOCK);
    }
}

// ── App Entry Point ──────────────────────────────────────────────────────────

pub fn run() {
    let env_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent().unwrap().join(".env");
    if env_path.exists() { dotenvy::from_path(&env_path).ok(); }

    let api_key = std::env::var("GROQ_API_KEY").unwrap_or_else(|_| {
        eprintln!("[vibe-voice] GROQ_API_KEY not set");
        String::new()
    });

    tauri::Builder::default()
        .manage(ApiKey(api_key))
        .manage(RecordingHandle(Mutex::new(None)))
        .manage(TrayHandle(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            start_recording,
            stop_transcribe,
            paste_text,
            set_tray_recording,
            flash_tray_done,
        ])
        .setup(|app| {
            // System tray
            match setup_tray(app) {
                Ok(tray) => {
                    *app.state::<TrayHandle>().0.lock().unwrap() = Some(tray);
                    eprintln!("[vibe-voice] tray icon ready");
                }
                Err(e) => eprintln!("[vibe-voice] tray setup failed: {e}"),
            }

            // Global hotkey listener (evdev — works on any Wayland compositor)
            spawn_global_hotkey_listener(app.handle().clone());

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("tauri error");
}
