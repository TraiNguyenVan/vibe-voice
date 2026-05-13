// Tauri injects window.__TAURI__ when withGlobalTauri: true (no bundler needed)
const { invoke }           = window.__TAURI__.core;
const { getCurrentWindow } = window.__TAURI__.window;

const appWindow = getCurrentWindow();

// ── DOM refs ──────────────────────────────────────────────────
const micBtn      = document.getElementById('mic-btn');
const micWrap     = document.getElementById('mic-wrap');
const statusEl    = document.getElementById('status');
const hintEl      = document.getElementById('hint');
const transcriptEl = document.getElementById('transcript');
const closeBtn    = document.getElementById('close-btn');
const app         = document.getElementById('app');

// ── State ─────────────────────────────────────────────────────
let mediaRecorder = null;
let audioChunks   = [];
let isRecording   = false;
let stream        = null;

// ── Close button ──────────────────────────────────────────────
closeBtn.addEventListener('click', () => appWindow.close());

// ── Status helpers ────────────────────────────────────────────
const STATUS = {
  idle:       { text: 'Hold to record',    cls: '' },
  recording:  { text: 'Recording…',        cls: 'status-recording' },
  thinking:   { text: 'Transcribing…',     cls: 'status-thinking' },
  done:       { text: '✓ Pasted!',          cls: 'status-done' },
  copied:     { text: '📋 Copied — Ctrl+V', cls: 'status-copied' },
  short:      { text: 'Too short — retry', cls: 'status-error' },
  error:      { text: 'Error — see console', cls: 'status-error' },
  nomic:      { text: 'Mic access denied', cls: 'status-error' },
};

function setStatus(key) {
  const s = STATUS[key] || STATUS.idle;
  statusEl.textContent = s.text;
  app.className = s.cls;
  // spinner only on thinking
  statusEl.classList.toggle('spinner', key === 'thinking');
}

function showTranscript(text) {
  if (!text) { transcriptEl.classList.remove('visible'); return; }
  const preview = text.length > 80 ? text.slice(0, 77) + '…' : text;
  transcriptEl.textContent = `"${preview}"`;
  transcriptEl.classList.add('visible');
}

// ── Mic permission (request early) ───────────────────────────
async function getMicStream() {
  if (stream) return stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    return stream;
  } catch {
    setStatus('nomic');
    return null;
  }
}

// ── Recording core ────────────────────────────────────────────
async function startRecording() {
  if (isRecording) return;
  const s = await getMicStream();
  if (!s) return;

  audioChunks = [];
  mediaRecorder = new MediaRecorder(s, { mimeType: 'audio/webm;codecs=opus' });
  mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
  mediaRecorder.start(100); // collect chunks every 100ms
  isRecording = true;

  micBtn.classList.add('recording');
  micWrap.classList.add('recording');
  transcriptEl.classList.remove('visible');
  setStatus('recording');
}

async function stopRecording() {
  if (!isRecording || !mediaRecorder) return;
  isRecording = false;

  micBtn.classList.remove('recording');
  micWrap.classList.remove('recording');

  await new Promise(resolve => {
    mediaRecorder.onstop = resolve;
    mediaRecorder.stop();
  });

  const blob = new Blob(audioChunks, { type: 'audio/webm' });

  // Guard: too short (< 0.4s worth of data — roughly 3 chunks at 100ms)
  if (audioChunks.length < 4 || blob.size < 2000) {
    setStatus('short');
    setTimeout(() => setStatus('idle'), 2000);
    return;
  }

  setStatus('thinking');
  await transcribeAndPaste(blob);
}

// ── Transcribe + paste ────────────────────────────────────────
async function transcribeAndPaste(blob) {
  try {
    const buffer    = await blob.arrayBuffer();
    const audioData = Array.from(new Uint8Array(buffer));

    const transcript = await invoke('transcribe', { audioData });

    if (!transcript || transcript.trim() === '') {
      setStatus('idle');
      return;
    }

    showTranscript(transcript);
    setStatus('thinking');

    // paste_text hides window, injects Ctrl+V, shows window again
    const pasted = await invoke('paste_text', { text: transcript });
    setStatus(pasted ? 'done' : 'copied');

    setTimeout(() => {
      setStatus('idle');
      setTimeout(() => transcriptEl.classList.remove('visible'), 400);
    }, 3000);

  } catch (err) {
    console.error('[vibe-voice]', err);
    setStatus('error');
    setTimeout(() => setStatus('idle'), 3000);
  }
}

// ── Push-to-talk: mouse ───────────────────────────────────────
micBtn.addEventListener('mousedown', e => { e.preventDefault(); startRecording(); });
window.addEventListener('mouseup',   ()  => { if (isRecording) stopRecording(); });

// ── Push-to-talk: Ctrl+Space toggle ──────────────────────────
let shortcutActive = false;
window.addEventListener('keydown', e => {
  if (e.code === 'Space' && e.ctrlKey && !shortcutActive) {
    e.preventDefault();
    shortcutActive = true;
    if (isRecording) stopRecording();
    else             startRecording();
  }
});
window.addEventListener('keyup', e => {
  if (e.code === 'Space') shortcutActive = false;
});

// ── Init ──────────────────────────────────────────────────────
setStatus('idle');
getMicStream(); // warm up mic permission on load
