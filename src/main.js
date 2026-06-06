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
const settingsBtn  = document.getElementById('settings-btn');
const settingsPanel = document.getElementById('settings-panel');
const apiKeyInput  = document.getElementById('api-key-input');
const autoTypeToggle = document.getElementById('auto-type-toggle');
const speedSlider  = document.getElementById('speed-slider');
const speedValue   = document.getElementById('speed-value');
const speedSettingGroup = document.getElementById('speed-setting-group');
const guiScaleSelect = document.getElementById('gui-scale-select');
const saveBtn      = document.getElementById('settings-save-btn');
const cancelBtn    = document.getElementById('settings-cancel-btn');
const settingsStatus = document.getElementById('settings-status');
const app          = document.getElementById('app');
const historyBtn     = document.getElementById('history-btn');
const historyPanel   = document.getElementById('history-panel');
const historyClearBtn = document.getElementById('history-clear-btn');
const historyList    = document.getElementById('history-list');
const hotkeyModSelect = document.getElementById('hotkey-mod-select');
const hotkeyTriggerSelect = document.getElementById('hotkey-trigger-select');
const hintEl         = document.getElementById('hint');


let isRecording = false;

// ── Settings / LocalStorage Keys ─────────────────────────────────────────────
const STORAGE_KEY  = 'vibe-voice-groq-api-key';
const AUTOTYPE_KEY = 'vibe-voice-auto-type';
const KEYHOLD_KEY  = 'vibe-voice-key-hold';
const GUISCALE_KEY = 'vibe-voice-gui-scale';
const HISTORY_KEY  = 'vibe-voice-transcript-history';
const HOTKEY_MOD_KEY = 'vibe-voice-hotkey-mod';
const HOTKEY_TRIGGER_KEY = 'vibe-voice-hotkey-trigger';

function getStoredApiKey() {
  return localStorage.getItem(STORAGE_KEY) || '';
}

function saveApiKey(key) {
  if (key) {
    localStorage.setItem(STORAGE_KEY, key);
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function getStoredAutoType() {
  const val = localStorage.getItem(AUTOTYPE_KEY);
  return val === null ? true : val === 'true';
}

function saveAutoType(enabled) {
  localStorage.setItem(AUTOTYPE_KEY, String(enabled));
}

function getStoredKeyHold() {
  const val = localStorage.getItem(KEYHOLD_KEY);
  return val === null ? 6 : parseInt(val, 10) || 6;
}

function saveKeyHold(val) {
  localStorage.setItem(KEYHOLD_KEY, String(val));
}

function getStoredGuiScale() {
  return localStorage.getItem(GUISCALE_KEY) || '1';
}

function saveGuiScale(val) {
  localStorage.setItem(GUISCALE_KEY, String(val));
}

function getStoredHotkeyMod() {
  return localStorage.getItem(HOTKEY_MOD_KEY) || 'Ctrl';
}

function getStoredHotkeyTrigger() {
  return localStorage.getItem(HOTKEY_TRIGGER_KEY) || 'Space';
}

function updateHintText() {
  if (!hintEl) return;
  const mod = getStoredHotkeyMod();
  const trigger = getStoredHotkeyTrigger();
  const combo = mod === 'None' ? trigger : `${mod}+${trigger}`;
  hintEl.textContent = `${combo} · drag to move`;
}

function saveHotkeyConfig(mod, trigger) {
  localStorage.setItem(HOTKEY_MOD_KEY, mod);
  localStorage.setItem(HOTKEY_TRIGGER_KEY, trigger);
  updateHintText();
  invoke('save_hotkeys', { modifier: mod, trigger: trigger }).catch(e => {
    console.error('[vibe-voice] save_hotkeys invoke failed:', e);
  });
}


function getHistory() {
  try {
    const list = localStorage.getItem(HISTORY_KEY);
    return list ? JSON.parse(list) : [];
  } catch {
    return [];
  }
}

function addHistoryItem(text) {
  if (!text || !text.trim()) return;
  const history = getHistory();
  if (history[0] === text.trim()) return;
  history.unshift(text.trim());
  const trimmed = history.slice(0, 5);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
  renderHistory();
}

function clearHistory() {
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
}

function renderHistory() {
  const history = getHistory();
  historyList.innerHTML = '';
  
  if (history.length === 0) {
    historyList.innerHTML = '<div class="history-empty">No history logs</div>';
    return;
  }
  
  history.forEach((text, index) => {
    const item = document.createElement('div');
    item.className = 'history-item';
    const preview = text.length > 50 ? text.slice(0, 47) + '...' : text;
    
    item.innerHTML = `
      <div class="history-text" title="${text}">[${index + 1}] ${preview}</div>
      <div class="history-actions">
        <button class="hist-act-btn hist-copy" data-index="${index}">[copy]</button>
        <button class="hist-act-btn hist-paste" data-index="${index}">[paste]</button>
      </div>
    `;
    
    item.querySelector('.hist-copy').addEventListener('click', () => {
      navigator.clipboard.writeText(text).then(() => {
        const originalText = item.querySelector('.hist-copy').textContent;
        item.querySelector('.hist-copy').textContent = '[copied]';
        setTimeout(() => {
          item.querySelector('.hist-copy').textContent = originalText;
        }, 1200);
      });
    });
    
    item.querySelector('.hist-paste').addEventListener('click', async () => {
      try {
        const originalText = item.querySelector('.hist-paste').textContent;
        item.querySelector('.hist-paste').textContent = '[pasting]';
        
        await invoke('paste_text', {
          text: text,
          autoType: true,
          keyHold: getStoredKeyHold()
        });
        
        item.querySelector('.hist-paste').textContent = originalText;
      } catch (err) {
        console.error('[vibe-voice] history paste failed:', err);
        item.querySelector('.hist-paste').textContent = '[err]';
        setTimeout(() => {
          item.querySelector('.hist-paste').textContent = '[paste]';
        }, 1200);
      }
    });
    
    historyList.appendChild(item);
  });
}

function applyGuiScale(val) {
  // CSS zoom on #app — WebKit supports this and it affects layout metrics
  app.style.setProperty('--gui-scale', val);
}

function updateSliderState(enabled) {
  if (enabled) {
    speedSettingGroup.classList.remove('disabled');
  } else {
    speedSettingGroup.classList.add('disabled');
  }
}

function updateSpeedValueLabel(ms) {
  speedValue.textContent = `${ms} ms`;
}

function toggleSettings() {
  const open = !settingsPanel.classList.contains('visible');
  if (open) {
    if (historyPanel.classList.contains('visible')) {
      historyPanel.classList.remove('visible');
      historyBtn.classList.remove('open');
    }
    const current = getStoredApiKey();
    apiKeyInput.value = current;

    // Load auto-type & delay settings
    const autoType = getStoredAutoType();
    const keyHold = getStoredKeyHold();
    autoTypeToggle.checked = autoType;
    speedSlider.value = keyHold;
    updateSpeedValueLabel(keyHold);
    updateSliderState(autoType);

    // Load hotkeys
    hotkeyModSelect.value = getStoredHotkeyMod();
    hotkeyTriggerSelect.value = getStoredHotkeyTrigger();

    // Load GUI scale
    guiScaleSelect.value = getStoredGuiScale();

    settingsStatus.textContent = '';
    settingsStatus.className = '';
    settingsBtn.classList.add('open');
  } else {
    settingsBtn.classList.remove('open');
    applyGuiScale(getStoredGuiScale());
  }
  settingsPanel.classList.toggle('visible', open);
}

function handleSettingsSave() {
  const key = apiKeyInput.value.trim();
  if (!key) {
    settingsStatus.textContent = 'Please enter an API key';
    settingsStatus.className = 'error';
    return;
  }
  saveApiKey(key);

  // Save auto-type & delay settings
  saveAutoType(autoTypeToggle.checked);
  saveKeyHold(parseInt(speedSlider.value, 10));

  // Save hotkeys
  saveHotkeyConfig(hotkeyModSelect.value, hotkeyTriggerSelect.value);

  // Save GUI scale
  const newScale = guiScaleSelect.value;
  saveGuiScale(newScale);
  applyGuiScale(newScale);

  settingsStatus.textContent = 'Key saved — ready to go';
  settingsStatus.className = '';
  setTimeout(() => {
    settingsPanel.classList.remove('visible');
    settingsBtn.classList.remove('open');
  }, 1500);

  setTimeout(() => {
    settingsStatus.textContent = '';
  }, 5000);
}

settingsBtn.addEventListener('click', toggleSettings);
cancelBtn.addEventListener('click', toggleSettings);
saveBtn.addEventListener('click', handleSettingsSave);
apiKeyInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') handleSettingsSave();
});
document.getElementById('get-key-btn').addEventListener('click', () => {
  invoke('open_url', { url: 'https://console.groq.com/keys' }).catch(err => {
    console.error('[vibe-voice] Failed to open URL:', err);
  });
});

autoTypeToggle.addEventListener('change', e => {
  updateSliderState(e.target.checked);
});

speedSlider.addEventListener('input', e => {
  updateSpeedValueLabel(e.target.value);
});

// Live preview: apply scale immediately when dropdown changes
guiScaleSelect.addEventListener('change', e => {
  applyGuiScale(e.target.value);
});

// Auto-open settings on first launch if no key saved
if (!getStoredApiKey()) {
  setTimeout(() => toggleSettings(), 500);
}

// Close button just hides the window (tray keeps the app alive)
closeBtn.addEventListener('click', () => appWindow.hide());

const STATUS = {
  idle:      { text: 'Hold to record',      cls: '' },
  recording: { text: 'Recording\u2026',     cls: 'status-recording' },
  thinking:  { text: 'Transcribing\u2026',  cls: 'status-thinking' },
  done:      { text: 'Pasted!',             cls: 'status-done' },
  copied:    { text: 'Copied \u2014 Ctrl+V', cls: 'status-copied' },
  short:     { text: 'Too short \u2014 retry', cls: 'status-error' },
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
  const preview = text.length > 80 ? text.slice(0, 77) + '\u2026' : text;
  transcriptEl.textContent = `\u201c${preview}\u201d`;
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
  invoke('set_tray_recording', { recording: false }).catch(() => {});

  try {
    const storedKey = getStoredApiKey();
    const args = storedKey ? { api_key: storedKey } : {};
    const transcript = await invoke('stop_transcribe', args);
    console.log('[vibe-voice] transcript:', transcript);

    if (!transcript || !transcript.trim()) { setStatus('idle'); return; }

    addHistoryItem(transcript);
    showTranscript(transcript);

    // ── Exit animation: play before window closes and typing begins ──
    app.classList.add('exiting');
    await new Promise(resolve => setTimeout(resolve, 260));

    const pasted = await invoke('paste_text', {
      text: transcript,
      autoType: getStoredAutoType(),
      keyHold: getStoredKeyHold()
    });

    // Window is now hidden. Clean up state for next activation.
    app.classList.remove('exiting');
    transcriptEl.classList.remove('visible');
    setStatus('idle');
    invoke('flash_tray_done').catch(() => {});

  } catch (err) {
    console.error('[vibe-voice] stop_transcribe error:', err);
    app.classList.remove('exiting');
    const msg = String(err);
    if (msg.includes('too short')) { setStatus('short'); }
    else { setStatus('error'); showTranscript(msg); }
    setTimeout(() => setStatus('idle'), 3000);
  }
}

// ── Mouse PTT ─────────────────────────────────────────────────────────────
micBtn.addEventListener('mousedown', e => { e.preventDefault(); startRecording(); });
window.addEventListener('mouseup',   ()  => { if (isRecording) stopAndTranscribe(); });

function isLocalModifierPressed(e) {
  const mod = getStoredHotkeyMod();
  if (mod === 'Ctrl') return e.ctrlKey;
  if (mod === 'Alt') return e.altKey;
  if (mod === 'Shift') return e.shiftKey;
  return true;
}

function isLocalTriggerKey(e) {
  const trigger = getStoredHotkeyTrigger();
  return e.code === trigger;
}

function isLocalModifierKey(e) {
  const mod = getStoredHotkeyMod();
  if (mod === 'Ctrl') return e.code === 'ControlLeft' || e.code === 'ControlRight';
  if (mod === 'Alt') return e.code === 'AltLeft' || e.code === 'AltRight';
  if (mod === 'Shift') return e.code === 'ShiftLeft' || e.code === 'ShiftRight';
  return false;
}

// ── Custom Dynamic hold-to-talk (window-local) ────────────────────────────
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

// ── Global Ctrl+Space PTT (evdev via Rust background thread) ─────────────
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
renderHistory();
updateHintText();
console.log('[vibe-voice] ready \u2014 tray + global hotkey active');

// Sync hotkey settings on startup
invoke('save_hotkeys', {
  modifier: getStoredHotkeyMod(),
  trigger: getStoredHotkeyTrigger()
}).catch(e => console.error('[vibe-voice] init save_hotkeys failed:', e));

function toggleHistory() {
  const open = !historyPanel.classList.contains('visible');
  if (open) {
    if (settingsPanel.classList.contains('visible')) {
      settingsPanel.classList.remove('visible');
      settingsBtn.classList.remove('open');
    }
    renderHistory();
    historyBtn.classList.add('open');
  } else {
    historyBtn.classList.remove('open');
  }
  historyPanel.classList.toggle('visible', open);
}

historyBtn.addEventListener('click', toggleHistory);
historyClearBtn.addEventListener('click', clearHistory);

// ── Auto-fit window height to content ────────────────────────────────────
function refitWindow() {
  // getBoundingClientRect returns the visual (zoom-aware) dimensions
  const rect = app.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    const LogicalSize = window.__TAURI__.window.LogicalSize;
    appWindow.setSize(new LogicalSize(Math.ceil(rect.width), Math.ceil(rect.height))).catch(() => {});
  }
}

// React to any size change in #app automatically
new ResizeObserver(() => refitWindow()).observe(app);
// Also fire once after fonts/icons have loaded
requestAnimationFrame(() => refitWindow());

// ── Apply persisted GUI scale on startup ─────────────────────────────────
applyGuiScale(getStoredGuiScale());

