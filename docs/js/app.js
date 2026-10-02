// Main App Controller - Shared Chatbot & Background Engine across all HTML pages
import { Scene3D } from './three-scene.js';
import { processGeminiRequest, clearChatHistory } from './gemini.js';
import { uploadToCloudinary } from './cloudinary.js';
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://qqjhadwxboeichxtxree.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFxamhhZHd4Ym9laWNoeHR4cmVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4NDY4ODAsImV4cCI6MjA5NTQyMjg4MH0.dM1VaV-lDPxoPlOHGAIbgfCSE3RMdURcVubq8tTs6yQ';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let scene3D = null;
let mainSpeechEnabled = true;
let chatSpeechEnabled = true;
let isMainRecording = false;
let isChatRecording = false;
let activeRecordingSource = null; // 'main' or 'chat'
let currentAttachment = null; // { base64, url }
let recognition = null;
let synth = window.speechSynthesis;
let currentElevenAudio = null;

const ALARMS_STORAGE_KEY = 'ia_agent_alarms_reminders';
let activeAlarmAudio = null;
let currentTriggeredAlarm = null;

let thoughtBubbleTimer = null;
let thoughtLoadingTimer = null;

function stopSpeech() {
  if (synth) synth.cancel();
  if (currentElevenAudio) {
    currentElevenAudio.pause();
    currentElevenAudio.currentTime = 0;
    currentElevenAudio = null;
  }
  if (scene3D) scene3D.setSpeakingState(false);
}

// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then((reg) => console.log('ServiceWorker registered:', reg.scope))
      .catch((err) => console.warn('ServiceWorker registration failed:', err));
  });
}

// Device ID tracking
function getDeviceId() {
  let devId = localStorage.getItem('ia_agent_device_id');
  if (!devId) {
    devId = 'dispositivo_' + Math.random().toString(36).substring(2, 9);
    localStorage.setItem('ia_agent_device_id', devId);
  }
  return devId;
}

// Global Professional Rule Editor Modal (No prompts/alerts)
window.openRuleEditorModal = function(rule, onSaveCallback) {
  let modal = document.getElementById('rule-editor-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'rule-editor-modal';
    modal.className = 'note-modal';
    modal.innerHTML = `
      <div class="note-modal-card" style="max-width: 520px; width: 92vw; padding: 24px;">
        <div class="modal-header">
          <h3 id="rule-modal-title">Editar Regla</h3>
          <button id="btn-close-rule-modal" class="btn-close-modal">✕</button>
        </div>
        <div class="modal-body" style="display: flex; flex-direction: column; gap: 16px; margin-top: 12px;">
          <div class="form-group">
            <label for="edit-rule-name">Nombre / Asunto</label>
            <input type="text" id="edit-rule-name" class="form-input">
          </div>
          <div class="form-row" style="gap: 12px; display: flex;">
            <div class="form-group flex-1">
              <label for="edit-rule-type">Tipo</label>
              <select id="edit-rule-type" class="form-input custom-select">
                <option value="recordatorio">Recordatorio</option>
                <option value="alarma">Alarma</option>
              </select>
            </div>
            <div class="form-group flex-1">
              <label for="edit-rule-time">Hora</label>
              <input type="time" id="edit-rule-time" class="form-input">
            </div>
          </div>
          <div class="form-group">
            <label>Modo de Horario</label>
            <div class="segmented-control" style="display: flex; gap: 8px; margin-top: 4px;">
              <button type="button" class="btn-tool edit-seg-schedule active" data-mode="days" id="btn-mode-days">Días de la semana</button>
              <button type="button" class="btn-tool edit-seg-schedule" data-mode="date" id="btn-mode-date">Fecha específica</button>
            </div>
          </div>
          <div class="form-group" id="edit-days-box">
            <label>Días activos</label>
            <div class="day-chips-group" style="display: flex; gap: 6px; flex-wrap: wrap;">
              <button type="button" class="day-chip edit-day-chip" data-day="1">Lun</button>
              <button type="button" class="day-chip edit-day-chip" data-day="2">Mar</button>
              <button type="button" class="day-chip edit-day-chip" data-day="3">Mié</button>
              <button type="button" class="day-chip edit-day-chip" data-day="4">Jue</button>
              <button type="button" class="day-chip edit-day-chip" data-day="5">Vie</button>
              <button type="button" class="day-chip edit-day-chip" data-day="6">Sáb</button>
              <button type="button" class="day-chip edit-day-chip" data-day="0">Dom</button>
            </div>
          </div>
          <div class="form-group" id="edit-date-box" style="display: none;">
            <label for="edit-rule-date">Fecha</label>
            <input type="date" id="edit-rule-date" class="form-input">
          </div>
          <div class="form-group">
            <label for="edit-rule-msg">Mensaje Hablado / Detalle</label>
            <textarea id="edit-rule-msg" class="form-textarea" style="min-height: 70px;"></textarea>
          </div>
          <div class="form-group" style="display: flex; align-items: center; justify-content: space-between;">
            <label style="margin: 0;">Estado Activo</label>
            <label class="switch-toggle">
              <input type="checkbox" id="edit-rule-active" checked>
              <span class="switch-slider"></span>
            </label>
          </div>
        </div>
        <div class="modal-footer" style="margin-top: 16px; display: flex; justify-content: flex-end; gap: 10px;">
          <button id="btn-cancel-edit-rule" class="btn-secondary-action">Cancelar</button>
          <button id="btn-save-edit-rule" class="btn-primary-action">Guardar Cambios</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('btn-close-rule-modal')?.addEventListener('click', () => modal.classList.remove('open'));
    document.getElementById('btn-cancel-edit-rule')?.addEventListener('click', () => modal.classList.remove('open'));

    document.getElementById('btn-mode-days')?.addEventListener('click', () => {
      document.getElementById('btn-mode-days').classList.add('active');
      document.getElementById('btn-mode-date').classList.remove('active');
      document.getElementById('edit-days-box').style.display = 'block';
      document.getElementById('edit-date-box').style.display = 'none';
    });

    document.getElementById('btn-mode-date')?.addEventListener('click', () => {
      document.getElementById('btn-mode-date').classList.add('active');
      document.getElementById('btn-mode-days').classList.remove('active');
      document.getElementById('edit-days-box').style.display = 'none';
      document.getElementById('edit-date-box').style.display = 'block';
    });

    modal.querySelectorAll('.edit-day-chip').forEach(chip => {
      chip.addEventListener('click', () => chip.classList.toggle('active'));
    });
  }

  const nameInput = document.getElementById('edit-rule-name');
  const typeSelect = document.getElementById('edit-rule-type');
  const timeInput = document.getElementById('edit-rule-time');
  const dateInput = document.getElementById('edit-rule-date');
  const msgInput = document.getElementById('edit-rule-msg');
  const activeCB = document.getElementById('edit-rule-active');
  const modalTitle = document.getElementById('rule-modal-title');

  const isNew = !rule || !rule.id;
  const currentRule = rule || {};

  if (modalTitle) {
    modalTitle.textContent = isNew ? 'Crear Nuevo Registro' : 'Editar Registro';
  }

  nameInput.value = currentRule.name || currentRule.title || '';
  typeSelect.value = currentRule.type || 'recordatorio';
  timeInput.value = currentRule.time || '08:00';
  dateInput.value = currentRule.date || new Date().toISOString().split('T')[0];
  msgInput.value = currentRule.message || currentRule.name || '';
  activeCB.checked = currentRule.active !== false;

  const mode = currentRule.scheduleMode || (currentRule.date ? 'date' : 'days');
  if (mode === 'date') {
    document.getElementById('btn-mode-date').click();
  } else {
    document.getElementById('btn-mode-days').click();
  }

  const activeDays = Array.isArray(currentRule.days) ? currentRule.days : [0, 1, 2, 3, 4, 5, 6];
  modal.querySelectorAll('.edit-day-chip').forEach(chip => {
    const d = parseInt(chip.getAttribute('data-day'));
    chip.classList.toggle('active', activeDays.includes(d));
  });

  const btnSave = document.getElementById('btn-save-edit-rule');
  btnSave.onclick = async () => {
    const newName = nameInput.value.trim();
    if (!newName) {
      showToast('Ingresa un nombre o asunto');
      return;
    }

    const isDaysMode = document.getElementById('btn-mode-days').classList.contains('active');
    const selectedDays = [];
    modal.querySelectorAll('.edit-day-chip.active').forEach(chip => {
      selectedDays.push(parseInt(chip.getAttribute('data-day')));
    });

    const updatedRule = {
      ...currentRule,
      id: currentRule.id || 'alg_' + Date.now(),
      category: 'algorithm',
      name: newName,
      title: newName,
      type: typeSelect.value,
      time: timeInput.value || '08:00',
      scheduleMode: isDaysMode ? 'days' : 'date',
      days: selectedDays,
      date: !isDaysMode ? dateInput.value : null,
      message: msgInput.value.trim() || newName,
      active: activeCB.checked,
      createdAt: currentRule.createdAt || new Date().toISOString()
    };

    const raw = localStorage.getItem(ALARMS_STORAGE_KEY);
    let allRules = raw ? JSON.parse(raw) : [];

    if (isNew) {
      try {
        const { data, error } = await supabase.from('alarms_reminders').insert([{
          type: updatedRule.type,
          name: updatedRule.name,
          message: updatedRule.message,
          schedule_mode: updatedRule.scheduleMode,
          days: updatedRule.days,
          specific_date: updatedRule.date,
          time: updatedRule.time,
          active: updatedRule.active
        }]).select();

        if (!error && data && data[0]) {
          updatedRule.db_id = data[0].id;
        }
      } catch (e) {}

      allRules.push(updatedRule);
      localStorage.setItem(ALARMS_STORAGE_KEY, JSON.stringify(allRules));
      showToast(`${updatedRule.type === 'alarma' ? 'Alarma' : 'Recordatorio'} creado exitosamente`);
    } else {
      const idx = allRules.findIndex(r => r.id === currentRule.id);
      if (idx !== -1) {
        allRules[idx] = updatedRule;
        localStorage.setItem(ALARMS_STORAGE_KEY, JSON.stringify(allRules));
      }

      try {
        if (currentRule.db_id) {
          await supabase.from('alarms_reminders').update({
            name: updatedRule.name,
            type: updatedRule.type,
            time: updatedRule.time,
            schedule_mode: updatedRule.scheduleMode,
            days: updatedRule.days,
            specific_date: updatedRule.date,
            message: updatedRule.message,
            active: updatedRule.active
          }).eq('id', currentRule.db_id);
        }
      } catch (e) {}

      showToast(`${updatedRule.type === 'alarma' ? 'Alarma' : 'Recordatorio'} actualizado exitosamente`);
    }

    modal.classList.remove('open');

    if (typeof onSaveCallback === 'function') {
      onSaveCallback(updatedRule);
    } else {
      window.location.reload();
    }
  };

  modal.classList.add('open');
};

// Ensure Chatbot UI elements exist on every HTML page
function ensureGlobalChatbotUI() {
  if (!document.querySelector('.thought-bubble-container')) {
    const thought = document.createElement('div');
    thought.className = 'thought-bubble-container hidden';
    thought.innerHTML = `
      <div id="thought-bubble" class="thought-bubble">
        <p id="thought-text">¡Hola! ¿En qué te puedo ayudar hoy?</p>
      </div>
      <div class="thought-tail">
        <div class="thought-tail-dot dot-1"></div>
        <div class="thought-tail-dot dot-2"></div>
      </div>
    `;
    document.body.appendChild(thought);
  }

  if (!document.querySelector('.bottom-control-bar')) {
    const ctrlBar = document.createElement('div');
    ctrlBar.className = 'bottom-control-bar';
    ctrlBar.innerHTML = `
      <button id="btn-camera" class="btn-icon" title="Camara" aria-label="Camara">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
      </button>
      <button id="btn-mic" class="btn-icon btn-main-mic" title="Hablar" aria-label="Hablar">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
      </button>
      <button id="btn-chat-toggle" class="btn-icon" title="Chat" aria-label="Chat">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
      </button>
    `;
    document.body.appendChild(ctrlBar);
  }

  if (!document.getElementById('chat-drawer')) {
    const drawer = document.createElement('aside');
    drawer.id = 'chat-drawer';
    drawer.className = 'chat-drawer';
    drawer.innerHTML = `
      <div class="chat-header">
        <div></div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <button id="btn-clear-chat" class="btn-icon" style="width: 36px; height: 36px;" title="Limpiar Chat" aria-label="Limpiar Chat">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
          <button id="btn-chat-toggle-speech" class="btn-icon active" style="width: 36px; height: 36px;" title="Voz en Chat" aria-label="Voz en Chat">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
          </button>
          <button id="btn-close-chat" class="btn-icon" style="width: 36px; height: 36px;" title="Cerrar Chat" aria-label="Cerrar Chat">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
      </div>
      <div id="chat-messages" class="chat-messages">
        <div class="chat-msg ai">¡Hola! ¿En qué te puedo ayudar hoy?</div>
      </div>
      <div id="attached-preview" style="display: none; padding: 8px 16px; background: #f8fafc; border-top: 1px solid #e2e8f0; align-items: center; justify-content: space-between;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <img id="attached-img" src="" style="width: 40px; height: 40px; border-radius: 8px; object-fit: cover;">
          <span style="font-size: 0.85rem; color: #475569;">Imagen adjunta</span>
        </div>
        <button id="btn-remove-attachment" style="background: none; border: none; font-size: 1.1rem; cursor: pointer;">✕</button>
      </div>
      <input type="file" id="chat-file-input" accept="image/*" style="display: none;">
      <div class="chat-input-bar">
        <button id="btn-chat-image" class="btn-chat-action" title="Cargar Imagen" aria-label="Cargar Imagen">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
        </button>
        <button id="btn-chat-mic" class="btn-chat-action" title="Hablar por voz" aria-label="Hablar por voz">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
        </button>
        <input type="text" id="chat-input" placeholder="Escribe un mensaje o arrastra una imagen..." autocomplete="off">
        <button id="btn-send-chat" class="btn-send" title="Enviar" aria-label="Enviar">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
        </button>
      </div>
    `;
    document.body.appendChild(drawer);
  }

  if (!document.getElementById('camera-modal')) {
    const camModal = document.createElement('div');
    camModal.id = 'camera-modal';
    camModal.className = 'camera-modal';
    camModal.innerHTML = `
      <div class="camera-box">
        <h3 style="font-size: 1.1rem; color: #1e1b4b; display: flex; align-items: center; gap: 8px;">Capturar Foto</h3>
        <video id="camera-stream" class="camera-preview" autoplay playsinline></video>
        <canvas id="camera-canvas" style="display: none;"></canvas>
        <div class="camera-controls">
          <button id="btn-snap-photo" class="btn-action btn-snap">Capturar Foto</button>
          <button id="btn-close-camera" class="btn-action btn-close-cam">Cancelar</button>
        </div>
      </div>
    `;
    document.body.appendChild(camModal);
  }

  if (!document.getElementById('alarm-modal')) {
    const almModal = document.createElement('div');
    almModal.id = 'alarm-modal';
    almModal.className = 'alarm-overlay-modal';
    almModal.innerHTML = `
      <div class="alarm-alert-card">
        <div style="font-size: 0.8rem; font-weight: 700; color: #9333ea; letter-spacing: 0.05em; text-transform: uppercase;" id="alarm-alert-type">Alarma Activa</div>
        <div class="alarm-alert-title" id="alarm-alert-name">Hora de despertar</div>
        <div class="alarm-alert-time" id="alarm-alert-time">07:00 AM</div>
        <div class="alarm-alert-msg" id="alarm-alert-msg">"Es hora de despertar y comenzar el dia."</div>
        <div class="alarm-alert-actions">
          <button id="btn-stop-alarm" class="btn-stop-alarm">Detener</button>
          <button id="btn-snooze-alarm" class="btn-snooze-alarm">Posponer 5 min</button>
        </div>
      </div>
    `;
    document.body.appendChild(almModal);
  }
}

function restoreChatSession() {
  try {
    const raw = sessionStorage.getItem('ia_agent_session_messages');
    if (raw) {
      const msgs = JSON.parse(raw);
      if (Array.isArray(msgs) && msgs.length > 0) {
        const chatMessages = document.getElementById('chat-messages');
        if (chatMessages) chatMessages.innerHTML = '';
        msgs.forEach((m) => {
          appendChatMessage(m.text, m.sender, m.imageBase64, false);
        });
      }
    }
  } catch (e) {}
}

document.addEventListener('DOMContentLoaded', () => {
  ensureGlobalChatbotUI();
  setup3DViewer();
  setupSpeechRecognition();
  setupEventListeners();
  restoreChatSession();
  requestPermissionsAndTrackLocation();
  initAlarmExecutionEngine();

  if (document.getElementById('bot-model-viewer')) {
    showThoughtBubble('¡Hola! ¿En qué te puedo ayudar hoy?', 3000);
  }
});

async function reverseGeocode(lat, lon) {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`, {
      headers: { 'Accept-Language': 'es' }
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.display_name) return data.display_name;
    }
  } catch (e) {}
  return `Latitud ${lat.toFixed(5)}, Longitud ${lon.toFixed(5)}`;
}

async function updateLocationInSupabase(lat, lon) {
  const deviceId = getDeviceId();
  const address = await reverseGeocode(lat, lon);
  try {
    await supabase.from('locations').upsert([{
      device_id: deviceId,
      latitude: lat,
      longitude: lon,
      address: address,
      updated_at: new Date().toISOString()
    }], { onConflict: 'device_id' });
  } catch (err) {}
}

function requestPermissionsAndTrackLocation() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
  if ('geolocation' in navigator) {
    const handlePos = (pos) => updateLocationInSupabase(pos.coords.latitude, pos.coords.longitude);
    navigator.geolocation.getCurrentPosition(handlePos, () => {}, { timeout: 10000, enableHighAccuracy: true });
    try {
      navigator.geolocation.watchPosition(handlePos, () => {}, { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 });
    } catch (e) {}
  }
}

function showThoughtBubbleLoading() {
  const container = document.querySelector('.thought-bubble-container');
  const thoughtText = document.getElementById('thought-text');
  const chatDrawer = document.getElementById('chat-drawer');
  if (chatDrawer && chatDrawer.classList.contains('open')) {
    hideThoughtBubble();
    return;
  }
  stopThoughtBubbleLoading();
  if (thoughtBubbleTimer) {
    clearTimeout(thoughtBubbleTimer);
    thoughtBubbleTimer = null;
  }
  let step = 0;
  const dots = ['.', '. .', '. . .'];
  if (thoughtText) thoughtText.innerText = dots[0];
  if (container) container.classList.remove('hidden');
  thoughtLoadingTimer = setInterval(() => {
    step = (step + 1) % dots.length;
    if (thoughtText) thoughtText.innerText = dots[step];
  }, 400);
}

function stopThoughtBubbleLoading() {
  if (thoughtLoadingTimer) {
    clearInterval(thoughtLoadingTimer);
    thoughtLoadingTimer = null;
  }
}

function showThoughtBubble(text, autoHideMs = 3000) {
  stopThoughtBubbleLoading();
  const container = document.querySelector('.thought-bubble-container');
  const thoughtText = document.getElementById('thought-text');
  const chatDrawer = document.getElementById('chat-drawer');
  if (chatDrawer && chatDrawer.classList.contains('open')) {
    hideThoughtBubble();
    return;
  }
  if (thoughtText) thoughtText.innerText = text;
  if (container) container.classList.remove('hidden');
  if (thoughtBubbleTimer) {
    clearTimeout(thoughtBubbleTimer);
    thoughtBubbleTimer = null;
  }
  if (autoHideMs && autoHideMs > 0) {
    thoughtBubbleTimer = setTimeout(() => hideThoughtBubble(), autoHideMs);
  }
}

function hideThoughtBubble() {
  stopThoughtBubbleLoading();
  const container = document.querySelector('.thought-bubble-container');
  if (container) container.classList.add('hidden');
  if (thoughtBubbleTimer) {
    clearTimeout(thoughtBubbleTimer);
    thoughtBubbleTimer = null;
  }
}

function showChatLoading() {
  const chatMessages = document.getElementById('chat-messages');
  if (!chatMessages) return null;
  const loadingDiv = document.createElement('div');
  loadingDiv.className = 'chat-msg ai loading-msg';
  loadingDiv.id = 'chat-loading-indicator';
  const textP = document.createElement('p');
  textP.innerText = 'Un momento...';
  loadingDiv.appendChild(textP);
  chatMessages.appendChild(loadingDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return loadingDiv;
}

function removeChatLoading(loadingElem) {
  if (loadingElem && loadingElem.parentNode) loadingElem.parentNode.removeChild(loadingElem);
  const existing = document.getElementById('chat-loading-indicator');
  if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
}

function setup3DViewer() {
  const modelViewer = document.getElementById('bot-model-viewer');
  if (modelViewer) {
    modelViewer.addEventListener('click', () => {
      if (currentTriggeredAlarm) {
        const actions = currentTriggeredAlarm.stopActions || ['button'];
        if (actions.includes('touch')) stopActiveAlarm();
      }
    });
    modelViewer.addEventListener('error', () => {
      modelViewer.style.display = 'none';
      scene3D = new Scene3D('canvas-container');
    });
  } else if (document.getElementById('canvas-container')) {
    scene3D = new Scene3D('canvas-container');
  }
}

function setupSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return;

  recognition = new SpeechRecognition();
  recognition.lang = 'es-ES';
  recognition.interimResults = false;
  recognition.continuous = false;

  recognition.onstart = () => {
    if (activeRecordingSource === 'main') {
      isMainRecording = true;
      const micBtn = document.getElementById('btn-mic');
      if (micBtn) micBtn.classList.add('recording');
      showThoughtBubble('Escuchando... Háblame', 0);
    } else if (activeRecordingSource === 'chat') {
      isChatRecording = true;
      const chatMicBtn = document.getElementById('btn-chat-mic');
      if (chatMicBtn) chatMicBtn.classList.add('recording');
    }
  };

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    const source = activeRecordingSource;
    stopRecording();
    handleUserInput(transcript, true, source === 'chat');
  };

  recognition.onerror = () => stopRecording();
  recognition.onend = () => stopRecording();
}

function stopRecording() {
  isMainRecording = false;
  isChatRecording = false;
  activeRecordingSource = null;

  const micBtn = document.getElementById('btn-mic');
  if (micBtn) micBtn.classList.remove('recording');

  const chatMicBtn = document.getElementById('btn-chat-mic');
  if (chatMicBtn) chatMicBtn.classList.remove('recording');
}

function setupEventListeners() {
  const btnClearChat = document.getElementById('btn-clear-chat');
  if (btnClearChat) {
    btnClearChat.addEventListener('click', () => {
      sessionStorage.removeItem('ia_agent_session_messages');
      clearChatHistory();
      const chatMessages = document.getElementById('chat-messages');
      if (chatMessages) {
        chatMessages.innerHTML = '<div class="chat-msg ai">¡Hola! ¿En qué te puedo ayudar hoy?</div>';
      }
      showToast('Conversación limpiada');
    });
  }

  const btnToggleSpeech = document.getElementById('btn-toggle-speech');
  if (btnToggleSpeech) {
    btnToggleSpeech.addEventListener('click', () => {
      mainSpeechEnabled = !mainSpeechEnabled;
      btnToggleSpeech.classList.toggle('active', mainSpeechEnabled);
      const chatDrawer = document.getElementById('chat-drawer');
      const isChatOpen = chatDrawer && chatDrawer.classList.contains('open');
      if (!isChatOpen && !mainSpeechEnabled) stopSpeech();
      showToast(mainSpeechEnabled ? 'Voz principal activada' : 'Voz principal desactivada');
    });
  }

  const btnChatToggleSpeech = document.getElementById('btn-chat-toggle-speech');
  if (btnChatToggleSpeech) {
    btnChatToggleSpeech.addEventListener('click', () => {
      chatSpeechEnabled = !chatSpeechEnabled;
      btnChatToggleSpeech.classList.toggle('active', chatSpeechEnabled);
      const chatDrawer = document.getElementById('chat-drawer');
      const isChatOpen = chatDrawer && chatDrawer.classList.contains('open');
      if (isChatOpen && !chatSpeechEnabled) stopSpeech();
      showToast(chatSpeechEnabled ? 'Voz de chat activada' : 'Voz de chat desactivada');
    });
  }

  const btnMic = document.getElementById('btn-mic');
  if (btnMic) {
    btnMic.addEventListener('click', () => {
      const chatDrawer = document.getElementById('chat-drawer');
      if (chatDrawer && chatDrawer.classList.contains('open')) {
        showToast('Cierra el chat para usar el micrófono principal.');
        return;
      }
      if (!recognition) {
        showToast('El reconocimiento de voz no está soportado.');
        return;
      }
      if (isMainRecording || isChatRecording) recognition.stop();
      else {
        activeRecordingSource = 'main';
        recognition.start();
      }
    });
  }

  const btnChatMic = document.getElementById('btn-chat-mic');
  if (btnChatMic) {
    btnChatMic.addEventListener('click', () => {
      if (!recognition) {
        showToast('El reconocimiento de voz no está soportado.');
        return;
      }
      if (isMainRecording || isChatRecording) recognition.stop();
      else {
        activeRecordingSource = 'chat';
        recognition.start();
      }
    });
  }

  const btnChatToggle = document.getElementById('btn-chat-toggle');
  const btnCloseChat = document.getElementById('btn-close-chat');
  const chatDrawer = document.getElementById('chat-drawer');

  if (btnChatToggle && chatDrawer) {
    btnChatToggle.addEventListener('click', () => {
      chatDrawer.classList.toggle('open');
      if (chatDrawer.classList.contains('open')) {
        hideThoughtBubble();
        if (!chatSpeechEnabled) stopSpeech();
      } else {
        if (!mainSpeechEnabled) stopSpeech();
      }
    });
  }

  if (btnCloseChat && chatDrawer) {
    btnCloseChat.addEventListener('click', () => {
      chatDrawer.classList.remove('open');
      if (!mainSpeechEnabled) stopSpeech();
    });
  }

  const btnSendChat = document.getElementById('btn-send-chat');
  const chatInput = document.getElementById('chat-input');

  if (btnSendChat && chatInput) {
    const send = () => {
      const text = chatInput.value.trim();
      if (text || currentAttachment) {
        chatInput.value = '';
        handleUserInput(text, false);
      }
    };
    btnSendChat.addEventListener('click', send);
    chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') send();
    });
  }

  const btnCamera = document.getElementById('btn-camera');
  const cameraModal = document.getElementById('camera-modal');
  const btnCloseCamera = document.getElementById('btn-close-camera');
  const btnSnapPhoto = document.getElementById('btn-snap-photo');
  const videoElem = document.getElementById('camera-stream');
  let mediaStream = null;

  if (btnCamera && cameraModal) {
    btnCamera.addEventListener('click', async () => {
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (videoElem) videoElem.srcObject = mediaStream;
        cameraModal.classList.add('open');
      } catch (err) {
        showToast('No se pudo acceder a la cámara.');
      }
    });
  }

  const closeCameraModal = () => {
    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop());
      mediaStream = null;
    }
    if (cameraModal) cameraModal.classList.remove('open');
  };

  if (btnCloseCamera) btnCloseCamera.addEventListener('click', closeCameraModal);

  if (btnSnapPhoto && videoElem) {
    btnSnapPhoto.addEventListener('click', async () => {
      const canvas = document.getElementById('camera-canvas');
      if (!canvas) return;
      canvas.width = videoElem.videoWidth || 640;
      canvas.height = videoElem.videoHeight || 480;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(videoElem, 0, 0, canvas.width, canvas.height);
      const base64Data = canvas.toDataURL('image/jpeg', 0.85);
      closeCameraModal();

      currentAttachment = { base64: base64Data };
      showAttachmentPreview(base64Data);

      uploadToCloudinary(base64Data).then((cloudUrl) => {
        if (cloudUrl) currentAttachment.url = cloudUrl;
      });

      showThoughtBubble('Foto capturada. Escríbeme o háblame para preguntarme sobre ella.', 4000);
      showToast('Foto cargada para análisis');
    });
  }

  const btnChatImage = document.getElementById('btn-chat-image');
  const chatFileInput = document.getElementById('chat-file-input');

  if (btnChatImage && chatFileInput) {
    btnChatImage.addEventListener('click', () => chatFileInput.click());
    chatFileInput.addEventListener('change', () => {
      if (chatFileInput.files && chatFileInput.files[0]) {
        processAndAttachImageFile(chatFileInput.files[0]);
      }
    });
  }

  if (chatDrawer) {
    ['dragenter', 'dragover'].forEach((eventName) => {
      chatDrawer.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        chatDrawer.classList.add('drag-over');
      });
    });

    ['dragleave', 'drop'].forEach((eventName) => {
      chatDrawer.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        chatDrawer.classList.remove('drag-over');
      });
    });

    chatDrawer.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      const files = dt.files;
      if (files && files.length > 0) {
        const file = files[0];
        if (file.type.startsWith('image/')) processAndAttachImageFile(file);
      }
    });
  }

  const btnRemoveAttach = document.getElementById('btn-remove-attachment');
  if (btnRemoveAttach) {
    btnRemoveAttach.addEventListener('click', () => {
      currentAttachment = null;
      const previewElem = document.getElementById('attached-preview');
      if (previewElem) previewElem.style.display = 'none';
    });
  }

  const btnStopAlarm = document.getElementById('btn-stop-alarm');
  const btnSnoozeAlarm = document.getElementById('btn-snooze-alarm');

  if (btnStopAlarm) btnStopAlarm.addEventListener('click', () => stopActiveAlarm());
  if (btnSnoozeAlarm) btnSnoozeAlarm.addEventListener('click', () => snoozeActiveAlarm(5));
}

function initAlarmExecutionEngine() {
  setInterval(checkAndExecuteAlarms, 10000);
  checkAndExecuteAlarms();
}

function checkAndExecuteAlarms() {
  const raw = localStorage.getItem(ALARMS_STORAGE_KEY);
  if (!raw) return;

  let rules = [];
  try {
    rules = JSON.parse(raw);
  } catch (e) {
    return;
  }

  if (!Array.isArray(rules) || rules.length === 0) return;

  const now = new Date();
  const currentDay = now.getDay();
  const currentDateStr = now.toISOString().split('T')[0];
  const currentHour = String(now.getHours()).padStart(2, '0');
  const currentMin = String(now.getMinutes()).padStart(2, '0');
  const currentTimeStr = `${currentHour}:${currentMin}`;

  rules.forEach((rule) => {
    if (!rule.active) return;

    if (rule.snoozeUntil) {
      if (now.getTime() >= rule.snoozeUntil) {
        rule.snoozeUntil = null;
        triggerAlarmEvent(rule);
        return;
      }
    }

    if (rule.lastExecuted) {
      const lastExecDate = new Date(rule.lastExecuted);
      const diffSecs = (now.getTime() - lastExecDate.getTime()) / 1000;
      if (diffSecs < 60) return;
    }

    let dayMatches = false;
    if (rule.scheduleMode === 'days') {
      const days = rule.days || [];
      dayMatches = days.length === 0 || days.includes(currentDay);
    } else if (rule.scheduleMode === 'date') {
      dayMatches = rule.date === currentDateStr;
    }

    if (!dayMatches) return;

    let timeMatches = false;
    if (rule.useRange && rule.rangeStart && rule.rangeEnd) {
      if (currentTimeStr >= rule.rangeStart && currentTimeStr <= rule.rangeEnd) {
        const limit = rule.rangeLimit || 1;
        const executionsToday = rule.executionCountInRange || 0;
        if (executionsToday < limit) timeMatches = true;
      }
    } else {
      timeMatches = currentTimeStr === rule.time;
    }

    if (timeMatches) triggerAlarmEvent(rule);
  });
}

function triggerAlarmEvent(rule) {
  currentTriggeredAlarm = rule;

  playAlarmAudio(rule);

  const spokenMsg = rule.message || rule.name;
  showThoughtBubble(spokenMsg, 10000);

  const chatDrawer = document.getElementById('chat-drawer');
  const isChatOpen = chatDrawer && chatDrawer.classList.contains('open');
  const allowVoice = isChatOpen ? chatSpeechEnabled : mainSpeechEnabled;
  if (allowVoice && spokenMsg) speakResponse(spokenMsg);

  const raw = localStorage.getItem(ALARMS_STORAGE_KEY);
  if (raw) {
    let rules = JSON.parse(raw);
    const idx = rules.findIndex((r) => r.id === rule.id);
    if (idx !== -1) {
      rules[idx].lastExecuted = new Date().toISOString();
      rules[idx].executionCountInRange = (rules[idx].executionCountInRange || 0) + 1;
      localStorage.setItem(ALARMS_STORAGE_KEY, JSON.stringify(rules));
    }
  }

  const alarmModal = document.getElementById('alarm-modal');
  const alarmType = document.getElementById('alarm-alert-type');
  const alarmName = document.getElementById('alarm-alert-name');
  const alarmTime = document.getElementById('alarm-alert-time');
  const alarmMsg = document.getElementById('alarm-alert-msg');

  if (alarmModal) {
    if (alarmType) alarmType.textContent = rule.type === 'alarma' ? 'Alarma Activa' : 'Recordatorio Activo';
    if (alarmName) alarmName.textContent = rule.name || rule.title;
    if (alarmTime) alarmTime.textContent = rule.time || '';
    if (alarmMsg) alarmMsg.textContent = `"${rule.message || rule.name}"`;
    alarmModal.classList.add('active');
  }

  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(rule.type === 'alarma' ? '¡Alarma de la IA!' : '¡Recordatorio de la IA!', {
        body: rule.message || rule.name,
        icon: './assets/img/icon-192.png'
      });
    } catch (e) {}
  }
}

function playAlarmAudio(rule) {
  stopAlarmAudio();
  if (rule.soundUrl) {
    activeAlarmAudio = new Audio(rule.soundUrl);
    activeAlarmAudio.loop = true;
    activeAlarmAudio.volume = rule.volume || 0.8;
    activeAlarmAudio.play().catch(() => playSynthesizedBeep());
  } else {
    playSynthesizedBeep();
  }
}

function playSynthesizedBeep() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 1.2);
  } catch (e) {}
}

function stopAlarmAudio() {
  if (activeAlarmAudio) {
    activeAlarmAudio.pause();
    activeAlarmAudio.currentTime = 0;
    activeAlarmAudio = null;
  }
}

function stopActiveAlarm() {
  stopAlarmAudio();
  stopSpeech();
  const alarmModal = document.getElementById('alarm-modal');
  if (alarmModal) alarmModal.classList.remove('active');
  if (currentTriggeredAlarm) {
    showToast(`Alarma "${currentTriggeredAlarm.name}" detenida.`);
    currentTriggeredAlarm = null;
  }
}

function snoozeActiveAlarm(minutes = 5) {
  stopAlarmAudio();
  stopSpeech();
  const alarmModal = document.getElementById('alarm-modal');
  if (alarmModal) alarmModal.classList.remove('active');
  if (currentTriggeredAlarm) {
    const raw = localStorage.getItem(ALARMS_STORAGE_KEY);
    if (raw) {
      let rules = JSON.parse(raw);
      const idx = rules.findIndex((r) => r.id === currentTriggeredAlarm.id);
      if (idx !== -1) {
        rules[idx].snoozeUntil = Date.now() + minutes * 60 * 1000;
        localStorage.setItem(ALARMS_STORAGE_KEY, JSON.stringify(rules));
      }
    }
    showToast(`Alarma pospuesta por ${minutes} minutos.`);
    currentTriggeredAlarm = null;
  }
}

function processAndAttachImageFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const base64Data = e.target.result;
    currentAttachment = { base64: base64Data };
    showAttachmentPreview(base64Data);

    uploadToCloudinary(base64Data).then((cloudUrl) => {
      if (cloudUrl) currentAttachment.url = cloudUrl;
    });

    showToast('Imagen adjuntada correctamente.');
  };
  reader.readAsDataURL(file);
}

function showAttachmentPreview(base64Src) {
  const previewElem = document.getElementById('attached-preview');
  const imgElem = document.getElementById('attached-img');
  if (previewElem && imgElem) {
    imgElem.src = base64Src;
    previewElem.style.display = 'flex';
  }
}

async function handleUserInput(text, isVoice = false, fromChat = false) {
  if (!text && !currentAttachment) return;

  if (currentTriggeredAlarm) {
    const actions = currentTriggeredAlarm.stopActions || ['button'];
    if (actions.includes('phrase')) {
      stopActiveAlarm();
      appendChatMessage(`[Alarma detenida por voz] ${text}`, 'user');
      return;
    }
  }

  appendChatMessage(text, 'user', currentAttachment ? currentAttachment.base64 : null);

  const attachedData = currentAttachment;
  currentAttachment = null;
  const previewElem = document.getElementById('attached-preview');
  if (previewElem) previewElem.style.display = 'none';

  const chatDrawer = document.getElementById('chat-drawer');
  const isChatOpen = fromChat || (chatDrawer && chatDrawer.classList.contains('open'));

  const chatLoadingElem = showChatLoading();

  if (!isChatOpen) showThoughtBubbleLoading();
  else hideThoughtBubble();

  try {
    const responseText = await processGeminiRequest(text, attachedData);

    stopThoughtBubbleLoading();
    removeChatLoading(chatLoadingElem);

    if (!isChatOpen) showThoughtBubble(responseText, 6000);
    else hideThoughtBubble();

    appendChatMessage(responseText, 'ai');

    if (isChatOpen) {
      if (chatSpeechEnabled && responseText) speakResponse(responseText, false);
    } else {
      if (mainSpeechEnabled && responseText) speakResponse(responseText, true);
    }
  } catch (err) {
    stopThoughtBubbleLoading();
    removeChatLoading(chatLoadingElem);
    const errorMsg = 'Lo siento, ocurrió un pequeño error. Por favor intenta de nuevo.';
    if (!isChatOpen) showThoughtBubble(errorMsg, 4000);
    else hideThoughtBubble();
    appendChatMessage(errorMsg, 'ai');
  }
}

function appendChatMessage(text, sender, imageBase64 = null, saveToSession = true) {
  const chatMessages = document.getElementById('chat-messages');
  if (!chatMessages) return;

  const msgDiv = document.createElement('div');
  msgDiv.className = `chat-msg ${sender}`;

  if (text) {
    const textP = document.createElement('p');
    textP.innerText = text;
    msgDiv.appendChild(textP);
  }

  if (imageBase64) {
    const img = document.createElement('img');
    img.src = imageBase64;
    msgDiv.appendChild(img);
  }

  if (sender === 'ai' && text) {
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'chat-msg-actions';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn-copy-msg';
    copyBtn.type = 'button';
    copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg> <span>Copiar</span>`;

    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(text).then(() => {
        showToast('Texto copiado al portapapeles');
      }).catch(() => {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        showToast('Texto copiado al portapapeles');
      });
    });

    actionsDiv.appendChild(copyBtn);
    msgDiv.appendChild(actionsDiv);
  }

  chatMessages.appendChild(msgDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  if (saveToSession) {
    try {
      const raw = sessionStorage.getItem('ia_agent_session_messages');
      let msgs = raw ? JSON.parse(raw) : [];
      msgs.push({ text, sender, imageBase64 });
      if (msgs.length > 30) msgs = msgs.slice(-30);
      sessionStorage.setItem('ia_agent_session_messages', JSON.stringify(msgs));
    } catch (e) {}
  }
}

async function speakResponse(text, isVoiceBubble = false) {
  const chatDrawer = document.getElementById('chat-drawer');
  const isChatOpen = chatDrawer && chatDrawer.classList.contains('open');

  if (isChatOpen && !chatSpeechEnabled) {
    stopSpeech();
    return;
  }
  if (!isChatOpen && !mainSpeechEnabled) {
    stopSpeech();
    return;
  }

  stopSpeech();

  const cleanText = (text || '').replace(/[*_#`~]/g, '').trim();
  if (!cleanText) return;

  let voiceSettings = null;
  try {
    const raw = localStorage.getItem('ia_agent_voice_settings');
    if (raw) voiceSettings = JSON.parse(raw);
  } catch (e) {}

  const voiceId = (voiceSettings && (voiceSettings.voice_id_es || voiceSettings.voice_id)) || '';

  if (!voiceId) return;

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/voz`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({
        action: 'text_to_speech',
        text: cleanText,
        voice_id: voiceId
      })
    });

    if (res.ok) {
      const data = await res.json();
      if (data && data.audio_base64) {
        currentElevenAudio = new Audio(`data:audio/mp3;base64,${data.audio_base64}`);
        if (scene3D) scene3D.setSpeakingState(true);

        currentElevenAudio.onended = () => {
          if (scene3D) scene3D.setSpeakingState(false);
          if (isVoiceBubble) setTimeout(() => hideThoughtBubble(), 2000);
        };

        currentElevenAudio.onerror = () => {
          if (scene3D) scene3D.setSpeakingState(false);
        };

        currentElevenAudio.play().catch(() => {
          if (scene3D) scene3D.setSpeakingState(false);
        });
      }
    }
  } catch (e) {}
}

function showToast(message) {
  const existing = document.querySelector('.toast-msg');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'toast-msg';
  toast.innerText = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    if (toast.parentNode) toast.parentNode.removeChild(toast);
  }, 2500);
}
