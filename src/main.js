if (!window.__TAURI__) throw new Error('__TAURI__ missing — check withGlobalTauri');

const { invoke }           = window.__TAURI__.core;
const { getCurrentWindow } = window.__TAURI__.window;
const { listen }           = window.__TAURI__.event;
const appWindow = getCurrentWindow();

const micBtn       = document.getElementById('mic-btn');
const micWrap      = document.getElementById('mic-wrap');
const statusEl     = document.getElementById('status');
const transcriptEl = document.getElementById('transcript');
const closeBtn     = document.getElementById('close-btn');
const app          = document.getElementById('app');

let isRecording = false;

// Close button just hides the window (tray keeps the app alive)
closeBtn.addEventListener('click', () => appWindow.hide());

const STATUS = {
  idle:      { text: 'Hold to record',      cls: '' },
  recording: { text: 'Recording…',          cls: 'status-recording' },
  thinking:  { text: 'Transcribing…',       cls: 'status-thinking' },
  done:      { text: '✓ Pasted!',            cls: 'status-done' },
  copied:    { text: '📋 Copied — Ctrl+V',  cls: 'status-copied' },
  short:     { text: 'Too short — retry',   cls: 'status-error' },
  error:     { text: 'Error',               cls: 'status-error' },
};

function setStatus(key) {
  const s = STATUS[key] || STATUS.idle;
  statusEl.textContent = s.text;
  app.className = s.cls;
  statusEl.classList.toggle('spinner', key === 'thinking');
}

function showTranscript(text) {
  if (!text) { transcriptEl.classList.remove('visible'); return; }
  const preview = text.length > 80 ? text.slice(0, 77) + '…' : text;
  transcriptEl.textContent = `"${preview}"`;
  transcriptEl.classList.add('visible');
}

async function startRecording() {
  if (isRecording) return;
  try {
    await invoke('start_recording');
    isRecording = true;
    micBtn.classList.add('recording');
    micWrap.classList.add('recording');
    transcriptEl.classList.remove('visible');
    setStatus('recording');
    // Sync tray icon to recording state
    invoke('set_tray_recording', { recording: true }).catch(() => {});
  } catch (err) {
    console.error('[vibe-voice] start_recording error:', err);
    showTranscript(String(err));
    setStatus('error');
    setTimeout(() => setStatus('idle'), 3000);
  }
}

async function stopAndTranscribe() {
  if (!isRecording) return;
  isRecording = false;
  micBtn.classList.remove('recording');
  micWrap.classList.remove('recording');
  setStatus('thinking');
  // Sync tray icon back to idle
  invoke('set_tray_recording', { recording: false }).catch(() => {});

  try {
    const transcript = await invoke('stop_transcribe');
    console.log('[vibe-voice] transcript:', transcript);

    if (!transcript || !transcript.trim()) { setStatus('idle'); return; }

    showTranscript(transcript);

    const pasted = await invoke('paste_text', { text: transcript });
    setStatus(pasted ? 'done' : 'copied');

    setTimeout(() => {
      setStatus('idle');
      setTimeout(() => transcriptEl.classList.remove('visible'), 400);
    }, 3000);

  } catch (err) {
    console.error('[vibe-voice] stop_transcribe error:', err);
    const msg = String(err);
    if (msg.includes('too short')) { setStatus('short'); }
    else { setStatus('error'); showTranscript(msg); }
    setTimeout(() => setStatus('idle'), 3000);
  }
}

// ── Mouse PTT ─────────────────────────────────────────────────────────────
micBtn.addEventListener('mousedown', e => { e.preventDefault(); startRecording(); });
window.addEventListener('mouseup',   ()  => { if (isRecording) stopAndTranscribe(); });

// ── Ctrl+Space hold-to-talk (window-local) ────────────────────────────────
// This fires when the vibe-voice window is focused.
// The global hotkey (evdev) fires even when the window is NOT focused.
window.addEventListener('keydown', e => {
  if (e.code === 'Space' && e.ctrlKey && !e.repeat) {
    e.preventDefault();
    startRecording();
  }
});
window.addEventListener('keyup', e => {
  if ((e.code === 'Space' || e.code === 'ControlLeft' || e.code === 'ControlRight') && isRecording) {
    e.preventDefault();
    stopAndTranscribe();
  }
});

// ── Global Ctrl+Space PTT (evdev via Rust background thread) ─────────────
// These events are emitted by the Rust evdev listener — works on any Wayland compositor
// even when this window has no focus.
listen('global-ptt-start', () => {
  console.log('[vibe-voice] global PTT start');
  startRecording();
}).catch(e => console.error('[vibe-voice] listen error:', e));

listen('global-ptt-stop', () => {
  console.log('[vibe-voice] global PTT stop');
  stopAndTranscribe();
}).catch(e => console.error('[vibe-voice] listen error:', e));

// ── Init ──────────────────────────────────────────────────────────────────
setStatus('idle');
console.log('[vibe-voice] ready — tray + global hotkey active');

// ── Auto-fit window height to content ────────────────────────────────────
// Measure the actual rendered #app height and resize the OS window to match.
// This eliminates blank space without guessing a fixed pixel value.
requestAnimationFrame(() => {
  const h = document.getElementById('app').scrollHeight;
  if (h > 0) {
    const LogicalSize = window.__TAURI__.window.LogicalSize;
    appWindow.setSize(new LogicalSize(340, h)).catch(() => {});
  }
});
