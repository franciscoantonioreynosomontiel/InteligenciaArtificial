// Main App Controller
import { Scene3D } from './three-scene.js';
import { processGeminiRequest, formulateAIReminderMessage } from './gemini.js';
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
let deferredInstallPrompt = null;

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

// Device ID tracking for two-person PWA setup
function getDeviceId() {
  let devId = localStorage.getItem('ia_agent_device_id');
  if (!devId) {
    devId = 'dispositivo_' + Math.random().toString(36).substring(2, 9);
    localStorage.setItem('ia_agent_device_id', devId);
  }
  return devId;
}

// Handle PWA Installability
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  console.log('PWA deferredInstallPrompt captured');
  showInstallPWAButton();
});

function showInstallPWAButton() {
  if (document.getElementById('btn-install-pwa')) return;
  const topActions = document.querySelector('.top-actions');
  if (!topActions) return;

  const btnInstall = document.createElement('button');
  btnInstall.id = 'btn-install-pwa';
  btnInstall.className = 'btn-icon';
  btnInstall.title = 'Instalar App Amigo';
  btnInstall.setAttribute('aria-label', 'Instalar App');
  btnInstall.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`;

  btnInstall.addEventListener('click', async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      const { outcome } = await deferredInstallPrompt.userChoice;
      console.log(`PWA install prompt outcome: ${outcome}`);
      deferredInstallPrompt = null;
      btnInstall.remove();
    }
  });

  topActions.insertBefore(btnInstall, topActions.firstChild);
}

const ALARMS_STORAGE_KEY = 'ia_agent_alarms_reminders';
let activeAlarmAudio = null;
let currentTriggeredAlarm = null;

let thoughtBubbleTimer = null;
let thoughtLoadingTimer = null;

document.addEventListener('DOMContentLoaded', () => {
  // 1. Setup 3D Model Viewer & Three.js Fallback
  setup3DViewer();

  // 2. Setup Speech Recognition
  setupSpeechRecognition();

  // 3. Setup UI Event Listeners
  setupEventListeners();

  // 4. Request Permissions & Track Location
  requestPermissionsAndTrackLocation();

  // 5. Start Real-time Alarm Execution Engine
  initAlarmExecutionEngine();

  // 6. Initial greeting bubble (shows briefly when opening PWA/page, then auto-hides after 3s max)
  showThoughtBubble('¡Hola! ¿En qué te puedo ayudar hoy?', 3000);
});

async function reverseGeocode(lat, lon) {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`, {
      headers: { 'Accept-Language': 'es' }
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.display_name) {
        return data.display_name;
      }
    }
  } catch (e) {
    console.warn('Reverse geocoding error:', e);
  }
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
    console.log(`Ubicacion sincronizada para ${deviceId}:`, address);
  } catch (err) {
    console.warn('Error sincronizando ubicacion a Supabase:', err);
  }
}

export async function refreshCurrentLocationRealtime() {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        await updateLocationInSupabase(lat, lon);
        resolve({ latitude: lat, longitude: lon });
      },
      (err) => {
        console.warn('Realtime location fetch error:', err.message);
        resolve(null);
      },
      { timeout: 8000, enableHighAccuracy: true }
    );
  });
}

function requestPermissionsAndTrackLocation() {
  // Notification Permission
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }

  // Geolocation Continuous Tracking
  if ('geolocation' in navigator) {
    const handlePos = (pos) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      console.log('Ubicación obtenida:', lat, lon);
      updateLocationInSupabase(lat, lon);
    };

    const handleErr = (err) => {
      console.warn('Permiso de ubicación no concedido o no disponible:', err.message);
    };

    navigator.geolocation.getCurrentPosition(handlePos, handleErr, { timeout: 10000, enableHighAccuracy: true });

    try {
      navigator.geolocation.watchPosition(handlePos, handleErr, {
        enableHighAccuracy: true,
        maximumAge: 15000,
        timeout: 20000
      });
    } catch (e) {
      console.warn('watchPosition failed:', e);
    }
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

  // If chat drawer is open, do not display thought bubble under any circumstance
  const chatDrawer = document.getElementById('chat-drawer');
  if (chatDrawer && chatDrawer.classList.contains('open')) {
    hideThoughtBubble();
    return;
  }

  if (thoughtText) {
    thoughtText.innerText = text;
  }

  if (container) {
    container.classList.remove('hidden');
  }

  if (thoughtBubbleTimer) {
    clearTimeout(thoughtBubbleTimer);
    thoughtBubbleTimer = null;
  }

  if (autoHideMs && autoHideMs > 0) {
    thoughtBubbleTimer = setTimeout(() => {
      hideThoughtBubble();
    }, autoHideMs);
  }
}

function hideThoughtBubble() {
  stopThoughtBubbleLoading();

  const container = document.querySelector('.thought-bubble-container');
  if (container) {
    container.classList.add('hidden');
  }
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
  if (loadingElem && loadingElem.parentNode) {
    loadingElem.parentNode.removeChild(loadingElem);
  }
  const existing = document.getElementById('chat-loading-indicator');
  if (existing && existing.parentNode) {
    existing.parentNode.removeChild(existing);
  }
}

function setup3DViewer() {
  const modelViewer = document.getElementById('bot-model-viewer');

  if (modelViewer) {
    // Handle touch stop for active alarm if configured. Clicking character does NOT open chat drawer.
    modelViewer.addEventListener('click', () => {
      if (currentTriggeredAlarm) {
        const actions = currentTriggeredAlarm.stopActions || ['button'];
        if (actions.includes('touch')) {
          stopActiveAlarm();
        }
      }
    });

    // Handle error loading GLTF -> fallback to Three.js procedurally generated character
    modelViewer.addEventListener('error', () => {
      console.warn('model-viewer failed to load GLTF, launching fallback 3D scene.');
      modelViewer.style.display = 'none';
      scene3D = new Scene3D('canvas-container');
    });
  } else {
    scene3D = new Scene3D('canvas-container');
  }
}

function setupSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.warn('Speech Recognition not supported in this browser.');
    return;
  }

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
    console.log('Voice Input:', transcript);
    const source = activeRecordingSource;
    stopRecording();
    handleUserInput(transcript, true, source === 'chat');
  };

  recognition.onerror = (event) => {
    console.error('Speech recognition error:', event.error);
    stopRecording();
  };

  recognition.onend = () => {
    stopRecording();
  };
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
  // Main Screen Speech Toggle
  const btnToggleSpeech = document.getElementById('btn-toggle-speech');
  if (btnToggleSpeech) {
    btnToggleSpeech.addEventListener('click', () => {
      mainSpeechEnabled = !mainSpeechEnabled;
      btnToggleSpeech.classList.toggle('active', mainSpeechEnabled);
      const chatDrawer = document.getElementById('chat-drawer');
      const isChatOpen = chatDrawer && chatDrawer.classList.contains('open');
      if (!isChatOpen && !mainSpeechEnabled) {
        stopSpeech();
      }
      showToast(mainSpeechEnabled ? 'Voz principal activada' : 'Voz principal desactivada');
    });
  }

  // Chat Drawer Speech Toggle
  const btnChatToggleSpeech = document.getElementById('btn-chat-toggle-speech');
  if (btnChatToggleSpeech) {
    btnChatToggleSpeech.addEventListener('click', () => {
      chatSpeechEnabled = !chatSpeechEnabled;
      btnChatToggleSpeech.classList.toggle('active', chatSpeechEnabled);
      const chatDrawer = document.getElementById('chat-drawer');
      const isChatOpen = chatDrawer && chatDrawer.classList.contains('open');
      if (isChatOpen && !chatSpeechEnabled) {
        stopSpeech();
      }
      showToast(chatSpeechEnabled ? 'Voz de chat activada' : 'Voz de chat desactivada');
    });
  }

  // Main Voice Mic Button
  const btnMic = document.getElementById('btn-mic');
  if (btnMic) {
    btnMic.addEventListener('click', () => {
      const chatDrawer = document.getElementById('chat-drawer');
      if (chatDrawer && chatDrawer.classList.contains('open')) {
        showToast('Cierra el chat para usar el micrófono principal.');
        return;
      }
      if (!recognition) {
        showToast('El reconocimiento de voz no está soportado en este navegador.');
        return;
      }
      if (isMainRecording || isChatRecording) {
        recognition.stop();
      } else {
        activeRecordingSource = 'main';
        recognition.start();
      }
    });
  }

  // Chat Mic Button
  const btnChatMic = document.getElementById('btn-chat-mic');
  if (btnChatMic) {
    btnChatMic.addEventListener('click', () => {
      if (!recognition) {
        showToast('El reconocimiento de voz no está soportado en este navegador.');
        return;
      }
      if (isMainRecording || isChatRecording) {
        recognition.stop();
      } else {
        activeRecordingSource = 'chat';
        recognition.start();
      }
    });
  }

  // Chat Drawer Toggle
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

  // Chat Send Action
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

  // Camera Integration
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
        console.error('Error accessing camera:', err);
        showToast('No se pudo acceder a la camara.');
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

      // Show attached preview
      currentAttachment = { base64: base64Data };
      showAttachmentPreview(base64Data);

      // Try uploading to Cloudinary in background if configured
      uploadToCloudinary(base64Data).then((cloudUrl) => {
        if (cloudUrl) {
          currentAttachment.url = cloudUrl;
          console.log('Image saved to Cloudinary:', cloudUrl);
        }
      });

      // Notify user
      showThoughtBubble('Foto capturada. Escribeme o hablame para preguntarme sobre ella.', 4000);
      showToast('Foto cargada para analisis');
    });
  }

  // Chat Image Upload Button & Hidden Input
  const btnChatImage = document.getElementById('btn-chat-image');
  const chatFileInput = document.getElementById('chat-file-input');

  if (btnChatImage && chatFileInput) {
    btnChatImage.addEventListener('click', () => {
      chatFileInput.click();
    });

    chatFileInput.addEventListener('change', () => {
      if (chatFileInput.files && chatFileInput.files[0]) {
        processAndAttachImageFile(chatFileInput.files[0]);
      }
    });
  }

  // Drag and Drop Image File Support on Chat Drawer
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
        if (file.type.startsWith('image/')) {
          processAndAttachImageFile(file);
        } else {
          showToast('Por favor arrastra un archivo de imagen válido.');
        }
      }
    });
  }

  // Remove attachment button
  const btnRemoveAttach = document.getElementById('btn-remove-attachment');
  if (btnRemoveAttach) {
    btnRemoveAttach.addEventListener('click', () => {
      currentAttachment = null;
      const previewElem = document.getElementById('attached-preview');
      if (previewElem) previewElem.style.display = 'none';
    });
  }

  // Active Alarm Modal Listeners
  const btnStopAlarm = document.getElementById('btn-stop-alarm');
  const btnSnoozeAlarm = document.getElementById('btn-snooze-alarm');

  if (btnStopAlarm) {
    btnStopAlarm.addEventListener('click', () => stopActiveAlarm());
  }

  if (btnSnoozeAlarm) {
    btnSnoozeAlarm.addEventListener('click', () => snoozeActiveAlarm(5));
  }

  // Request Notification permission for background alarms
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
}

// ==========================================================================
// Real-Time Alarm & Reminder Engine
// ==========================================================================

function initAlarmExecutionEngine() {
  // Check every 10 seconds
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
  const currentDay = now.getDay(); // 0 = Dom, 1 = Lun, ...
  const currentDateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
  const currentHour = String(now.getHours()).padStart(2, '0');
  const currentMin = String(now.getMinutes()).padStart(2, '0');
  const currentTimeStr = `${currentHour}:${currentMin}`;

  rules.forEach((rule) => {
    if (!rule.active) return;

    // Check if snooze is pending
    if (rule.snoozeUntil) {
      if (now.getTime() >= rule.snoozeUntil) {
        rule.snoozeUntil = null;
        triggerAlarmEvent(rule);
        return;
      }
    }

    // Check last execution to prevent re-triggering in the same minute
    if (rule.lastExecuted) {
      const lastExecDate = new Date(rule.lastExecuted);
      const diffSecs = (now.getTime() - lastExecDate.getTime()) / 1000;
      if (diffSecs < 60) return; // Wait at least 1 minute
    }

    // Check schedule mode
    let dayMatches = false;
    if (rule.scheduleMode === 'days') {
      const days = rule.days || [];
      dayMatches = days.length === 0 || days.includes(currentDay);
    } else if (rule.scheduleMode === 'date') {
      dayMatches = rule.date === currentDateStr;
    }

    if (!dayMatches) return;

    // Check exact time or time range
    let timeMatches = false;

    if (rule.useRange && rule.rangeStart && rule.rangeEnd) {
      if (currentTimeStr >= rule.rangeStart && currentTimeStr <= rule.rangeEnd) {
        const limit = rule.rangeLimit || 1;
        const executionsToday = rule.executionCountInRange || 0;
        if (executionsToday < limit) {
          timeMatches = true;
        }
      }
    } else {
      timeMatches = currentTimeStr === rule.time;
    }

    if (timeMatches) {
      triggerAlarmEvent(rule);
    }
  });
}

function triggerAlarmEvent(rule) {
  currentTriggeredAlarm = rule;

  // 1. Play sound
  playAlarmAudio(rule);

  // 2. Speak message & Display in character's thought bubble automatically
  const spokenMsg = rule.message || rule.name;
  showThoughtBubble(spokenMsg, 10000);

  const chatDrawer = document.getElementById('chat-drawer');
  const isChatOpen = chatDrawer && chatDrawer.classList.contains('open');
  const allowVoice = isChatOpen ? chatSpeechEnabled : mainSpeechEnabled;
  if (allowVoice && spokenMsg) {
    speakResponse(spokenMsg);
  }

  // 3. Update execution timestamp
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

  // 4. Show modal UI
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

  // 5. Trigger Web Notification (push-like alert from the bot character)
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
    activeAlarmAudio.play().catch((err) => {
      console.warn('Could not play audio sound file, falling back to Web Audio tone:', err);
      playSynthesizedBeep();
    });
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
    osc.frequency.setValueAtTime(880, ctx.currentTime); // A5 note
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
  if (alarmModal) {
    alarmModal.classList.remove('active');
  }

  if (currentTriggeredAlarm) {
    showToast(`Alarma "${currentTriggeredAlarm.name}" detenida.`);
    currentTriggeredAlarm = null;
  }
}

function snoozeActiveAlarm(minutes = 5) {
  stopAlarmAudio();
  stopSpeech();

  const alarmModal = document.getElementById('alarm-modal');
  if (alarmModal) {
    alarmModal.classList.remove('active');
  }

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
      if (cloudUrl) {
        currentAttachment.url = cloudUrl;
      }
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

  // Check if active alarm can be stopped by phrase/speaking
  if (currentTriggeredAlarm) {
    const actions = currentTriggeredAlarm.stopActions || ['button'];
    if (actions.includes('phrase')) {
      stopActiveAlarm();
      appendChatMessage(`[Alarma detenida por voz] ${text}`, 'user');
      return;
    }
  }

  // Add message to chat list UI
  appendChatMessage(text, 'user', currentAttachment ? currentAttachment.base64 : null);

  const attachedData = currentAttachment;
  currentAttachment = null;
  const previewElem = document.getElementById('attached-preview');
  if (previewElem) previewElem.style.display = 'none';

  const chatDrawer = document.getElementById('chat-drawer');
  const isChatOpen = fromChat || (chatDrawer && chatDrawer.classList.contains('open'));

  const chatLoadingElem = showChatLoading();

  if (!isChatOpen) {
    showThoughtBubbleLoading();
  } else {
    hideThoughtBubble();
  }

  try {
    const responseText = await processGeminiRequest(text, attachedData);

    stopThoughtBubbleLoading();
    removeChatLoading(chatLoadingElem);

    if (!isChatOpen) {
      showThoughtBubble(responseText, 6000);
    } else {
      hideThoughtBubble();
    }

    // Display response in chat
    appendChatMessage(responseText, 'ai');

    // Speak response depending on whether interaction happened on main screen or inside chat
    if (isChatOpen) {
      if (chatSpeechEnabled && responseText) {
        speakResponse(responseText, false);
      }
    } else {
      if (mainSpeechEnabled && responseText) {
        speakResponse(responseText, true);
      }
    }
  } catch (err) {
    console.error('Error processing AI response:', err);
    stopThoughtBubbleLoading();
    removeChatLoading(chatLoadingElem);

    const errorMsg = 'Lo siento, ocurrió un pequeño error. Por favor intenta de nuevo.';
    if (!isChatOpen) {
      showThoughtBubble(errorMsg, 4000);
    } else {
      hideThoughtBubble();
    }
    appendChatMessage(errorMsg, 'ai');
  }
}

function appendChatMessage(text, sender, imageBase64 = null) {
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
}

async function speakResponse(text, isVoiceBubble = false) {
  const chatDrawer = document.getElementById('chat-drawer');
  const isChatOpen = chatDrawer && chatDrawer.classList.contains('open');

  // Strict check on voice toggles
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

  // Check ElevenLabs settings
  let voiceSettings = null;
  try {
    const raw = localStorage.getItem('ia_agent_voice_settings');
    if (raw) voiceSettings = JSON.parse(raw);
  } catch (e) {}

  const voiceId = (voiceSettings && (voiceSettings.voice_id_es || voiceSettings.voice_id)) || '';

  if (!voiceId) {
    console.warn('No hay voz de ElevenLabs configurada en ia_agent_voice_settings.');
    return;
  }

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
          if (isVoiceBubble) {
            setTimeout(() => hideThoughtBubble(), 2000);
          }
        };

        currentElevenAudio.onerror = () => {
          if (scene3D) scene3D.setSpeakingState(false);
        };

        currentElevenAudio.play().catch((e) => {
          console.warn('Error al reproducir audio de ElevenLabs:', e);
          if (scene3D) scene3D.setSpeakingState(false);
        });
      } else if (data && data.error) {
        console.warn('ElevenLabs TTS devolvió un error:', data.error);
      }
    }
  } catch (e) {
    console.warn('Falló la llamada a la Edge Function de ElevenLabs TTS:', e);
  }
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
