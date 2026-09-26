// Main App Controller
import { Scene3D } from './three-scene.js';
import { processGeminiRequest } from './gemini.js';
import { uploadToCloudinary } from './cloudinary.js';

let scene3D = null;
let speechEnabled = true;
let isRecording = false;
let currentAttachment = null; // { base64, url }
let recognition = null;
let synth = window.speechSynthesis;

// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js')
    .then((reg) => console.log('ServiceWorker registered:', reg.scope))
    .catch((err) => console.warn('ServiceWorker registration failed:', err));
}

const ALARMS_STORAGE_KEY = 'ia_agent_alarms_reminders';
let activeAlarmAudio = null;
let currentTriggeredAlarm = null;

document.addEventListener('DOMContentLoaded', () => {
  // 1. Setup 3D Model Viewer & Three.js Fallback
  setup3DViewer();

  // 2. Setup Speech Recognition
  setupSpeechRecognition();

  // 3. Setup UI Event Listeners
  setupEventListeners();

  // 4. Start Real-time Alarm Execution Engine
  initAlarmExecutionEngine();
});

function setup3DViewer() {
  const modelViewer = document.getElementById('bot-model-viewer');

  if (modelViewer) {
    // Open chat drawer when clicking on the model viewer character
    modelViewer.addEventListener('click', () => {
      const chatDrawer = document.getElementById('chat-drawer');
      if (chatDrawer) {
        chatDrawer.classList.add('open');
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
    isRecording = true;
    const micBtn = document.getElementById('btn-mic');
    if (micBtn) micBtn.classList.add('recording');
    updateThoughtBubble('Escuchando... Hablame');
  };

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    console.log('Voice Input:', transcript);
    handleUserInput(transcript);
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
  isRecording = false;
  const micBtn = document.getElementById('btn-mic');
  if (micBtn) micBtn.classList.remove('recording');
}

function setupEventListeners() {
  // Speech Output Toggle
  const btnToggleSpeech = document.getElementById('btn-toggle-speech');
  if (btnToggleSpeech) {
    btnToggleSpeech.addEventListener('click', () => {
      speechEnabled = !speechEnabled;
      btnToggleSpeech.classList.toggle('active', speechEnabled);
      showToast(speechEnabled ? 'Voz activada' : 'Voz desactivada');
    });
  }

  // Voice Mic Button
  const btnMic = document.getElementById('btn-mic');
  if (btnMic) {
    btnMic.addEventListener('click', () => {
      if (!recognition) {
        showToast('El reconocimiento de voz no esta soportado en este navegador.');
        return;
      }
      if (isRecording) {
        recognition.stop();
      } else {
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
    });
  }

  if (btnCloseChat && chatDrawer) {
    btnCloseChat.addEventListener('click', () => {
      chatDrawer.classList.remove('open');
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
        handleUserInput(text);
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
      updateThoughtBubble('Foto capturada. Escribeme o hablame para preguntarme sobre ella.');
      showToast('Foto cargada para analisis');
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

  // 2. Speak message
  updateThoughtBubble(rule.message || rule.name);
  if (speechEnabled && rule.message) {
    speakResponse(rule.message);
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

  // 5. Trigger Web Notification
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(rule.type === 'alarma' ? 'Alarma!' : 'Recordatorio!', {
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
  synth.cancel();

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
  synth.cancel();

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

function showAttachmentPreview(base64Src) {
  const previewElem = document.getElementById('attached-preview');
  const imgElem = document.getElementById('attached-img');
  if (previewElem && imgElem) {
    imgElem.src = base64Src;
    previewElem.style.display = 'flex';
  }
}

async function handleUserInput(text) {
  if (!text && !currentAttachment) return;

  // Add message to chat list UI
  appendChatMessage(text, 'user', currentAttachment ? currentAttachment.base64 : null);

  const attachedData = currentAttachment;
  currentAttachment = null;
  const previewElem = document.getElementById('attached-preview');
  if (previewElem) previewElem.style.display = 'none';

  // Thought bubble thinking state
  updateThoughtBubble('Pensando...');

  try {
    const responseText = await processGeminiRequest(text, attachedData);

    // Display response in thought bubble
    updateThoughtBubble(responseText);

    // Display response in chat
    appendChatMessage(responseText, 'ai');

    // Speak response if voice enabled
    if (speechEnabled && responseText) {
      speakResponse(responseText);
    }
  } catch (err) {
    console.error('Error processing AI response:', err);
    const errorMsg = 'Lo siento, ocurrio un pequeño error. Por favor intenta de nuevo.';
    updateThoughtBubble(errorMsg);
    appendChatMessage(errorMsg, 'ai');
  }
}

function updateThoughtBubble(text) {
  const thoughtText = document.getElementById('thought-text');
  if (thoughtText) {
    thoughtText.innerText = text;
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

  chatMessages.appendChild(msgDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function speakResponse(text) {
  if (!synth) return;

  synth.cancel(); // Cancel any ongoing speech

  // Strip markdown formatting for cleaner TTS
  const cleanText = text.replace(/[*_#`~]/g, '');
  const utterance = new SpeechSynthesisUtterance(cleanText);
  utterance.lang = 'es-ES';
  utterance.rate = 1.0;
  utterance.pitch = 1.1;

  utterance.onstart = () => {
    if (scene3D) scene3D.setSpeakingState(true);
  };

  utterance.onend = () => {
    if (scene3D) scene3D.setSpeakingState(false);
  };

  utterance.onerror = () => {
    if (scene3D) scene3D.setSpeakingState(false);
  };

  synth.speak(utterance);
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
