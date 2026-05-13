use std::process::Command;
use std::thread;
use std::time::Duration;

use reqwest::multipart;
use tauri::{Manager, State};

// ── API key storage ───────────────────────────────────────────
pub struct ApiKey(pub String);

// ── Groq endpoint ─────────────────────────────────────────────
const GROQ_URL: &str = "https://api.groq.com/openai/v1/audio/transcriptions";
const MODEL: &str = "whisper-large-v3-turbo";

// ── transcribe command ────────────────────────────────────────
#[tauri::command]
async fn transcribe(
    audio_data: Vec<u8>,
    api_key: State<'_, ApiKey>,
) -> Result<String, String> {
    if audio_data.is_empty() {
        return Err("Empty audio data".into());
    }

    let key = api_key.0.clone();

    let part = multipart::Part::bytes(audio_data)
        .file_name("audio.webm")
        .mime_str("audio/webm")
        .map_err(|e| e.to_string())?;

    let form = multipart::Form::new()
        .text("model", MODEL)
        .text("response_format", "text")
        .part("file", part);

    let client = reqwest::Client::new();
    let response = client
        .post(GROQ_URL)
        .header("Authorization", format!("Bearer {}", key))
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| format!("Response read error: {}", e))?;

    if !status.is_success() {
        return Err(format!("Groq API error {}: {}", status, body));
    }

    Ok(body.trim().to_string())
}

// ── paste_text command ────────────────────────────────────────
// Hides the Vibe Voice window first so the previous app regains focus,
// then uses wl-copy + ydotool to paste at the evdev level.
#[tauri::command]
async fn paste_text(
    text: String,
    window: tauri::WebviewWindow,
) -> Result<bool, String> {
    // Step 1: write to Wayland clipboard
    let clip_ok = Command::new("wl-copy")
        .arg(&text)
        .status()
        .map(|s| s.success())
        .unwrap_or(false);

    if !clip_ok {
        return Err("wl-copy failed".into());
    }

    // Step 2: hide Vibe Voice window so previous app gets focus back
    window.hide().map_err(|e| e.to_string())?;

    // Step 3: give compositor time to re-focus the previous window
    thread::sleep(Duration::from_millis(300));

    // Step 4: simulate Ctrl+V via ydotool at evdev level (bypasses Wayland security)
    // Key codes: 29 = Left Ctrl, 47 = V
    let paste_ok = Command::new("ydotool")
        .args(["key", "29:1", "47:1", "47:0", "29:0"])
        .status()
        .map(|s| s.success())
        .unwrap_or(false);

    // Step 5: show window again after paste
    thread::sleep(Duration::from_millis(200));
    window.show().ok();
    window.set_focus().ok();

    Ok(paste_ok)
}

// ── app entry (called from main.rs) ──────────────────────────
pub fn run() {
    // Load .env from project root (parent of src-tauri/)
    let env_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join(".env");

    if env_path.exists() {
        dotenvy::from_path(&env_path).ok();
    }

    let api_key = std::env::var("GROQ_API_KEY").unwrap_or_else(|_| {
        eprintln!("[vibe-voice] GROQ_API_KEY not set. Add it to .env");
        String::new()
    });

    tauri::Builder::default()
        .manage(ApiKey(api_key))
        .invoke_handler(tauri::generate_handler![transcribe, paste_text])
        .setup(|app| {
            let win = app.get_webview_window("main").unwrap();
            // Force WebKit surface to be fully transparent — fixes Hyprland gray background
            win.set_background_color(Some(tauri::Color(0, 0, 0, 0)))?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
