use std::sync::Mutex;
use std::process::Command;
use reqwest::multipart;
use tauri::State;

pub struct ApiKey(pub String);
pub struct RecordingHandle(pub Mutex<Option<std::process::Child>>);

const GROQ_URL: &str = "https://api.groq.com/openai/v1/audio/transcriptions";
const MODEL: &str    = "whisper-large-v3-turbo";
const TMP_WAV: &str  = "/tmp/vibe-voice-rec.wav";

#[tauri::command]
fn start_recording(handle: State<'_, RecordingHandle>) -> Result<(), String> {
    let mut guard = handle.0.lock().unwrap();
    if guard.is_some() { return Ok(()); }

    let _ = std::fs::remove_file(TMP_WAV);

    let child = Command::new("parec")
        .args(["--channels=1", "--rate=16000", "--format=s16le",
               "--file-format=wav", "--latency-msec=50", TMP_WAV])
        .spawn()
        .map_err(|e| format!("parec failed: {e}"))?;

    *guard = Some(child);
    Ok(())
}

#[tauri::command]
async fn stop_transcribe(
    handle: State<'_, RecordingHandle>,
    api_key: State<'_, ApiKey>,
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
        .header("Authorization", format!("Bearer {}", api_key.0))
        .multipart(form)
        .send().await
        .map_err(|e| format!("network: {e}"))?;

    let status = resp.status();
    let body   = resp.text().await.map_err(|e| e.to_string())?;

    if !status.is_success() {
        return Err(format!("Groq {status}: {body}"));
    }
    Ok(body.trim().to_string())
}

#[tauri::command]
async fn paste_text(text: String, window: tauri::WebviewWindow) -> Result<bool, String> {
    Command::new("wl-copy").arg(&text).status().map_err(|e| e.to_string())?;
    window.hide().ok();
    std::thread::sleep(std::time::Duration::from_millis(300));
    let ok = Command::new("ydotool")
        .args(["key", "29:1", "47:1", "47:0", "29:0"])
        .status().map(|s| s.success()).unwrap_or(false);
    std::thread::sleep(std::time::Duration::from_millis(150));
    window.show().ok();
    window.set_focus().ok();
    Ok(ok)
}

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
        .invoke_handler(tauri::generate_handler![start_recording, stop_transcribe, paste_text])
        .setup(|_app| Ok(()))
        .run(tauri::generate_context!())
        .expect("tauri error");
}
