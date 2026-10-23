// Medical Assistant Client Logic - docs/js/medical.js
import { Scene3D } from './three-scene.js';

const SUPABASE_URL = 'https://qqjhadwxboeichxtxree.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFxamhhZHd4Ym9laWNoeHR4cmVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4NDY4ODAsImV4cCI6MjA5NTQyMjg4MH0.dM1VaV-lDPxoPlOHGAIbgfCSE3RMdURcVubq8tTs6yQ';
const MEDICAL_EDGE_FUNCTION = 'medical';

let scene3D = null;
let mainSpeechEnabled = true;
let chatSpeechEnabled = true;
let isMainRecording = false;
let isChatRecording = false;
let activeRecordingSource = null;
let recognition = null;
let currentElevenAudio = null;
let chatHistory = [];

let thoughtBubbleTimer = null;
let thoughtLoadingTimer = null;

function stopSpeech() {
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  if (currentElevenAudio) {
    currentElevenAudio.pause();
    currentElevenAudio.currentTime = 0;
    currentElevenAudio = null;
  }
  if (scene3D) scene3D.setSpeakingState(false);
}

document.addEventListener('DOMContentLoaded', () => {
  setup3DViewer();
  setupSpeechRecognition();
  setupEventListeners();
  restoreMedicalSession();

  // Check URL query parameters for initial symptoms from redirection
  const urlParams = new URLSearchParams(window.location.search);
  const promptParam = urlParams.get('prompt') || urlParams.get('sintoma');
  if (promptParam) {
    setTimeout(() => {
      handleUserInput(decodeURIComponent(promptParam), false);
    }, 600);
  }
});

function restoreMedicalSession() {
  try {
    const raw = sessionStorage.getItem('ia_agent_medical_messages');
    if (raw) {
      const msgs = JSON.parse(raw);
      if (Array.isArray(msgs) && msgs.length > 0) {
        const chatMessages = document.getElementById('chat-messages');
        if (chatMessages) chatMessages.innerHTML = '';
        msgs.forEach((m) => {
          appendChatMessage(m.text, m.sender, false);
          chatHistory.push({
            role: m.sender === 'user' ? 'user' : 'assistant',
            content: m.text
          });
        });
      }
    }
  } catch (e) {}
}

function setup3DViewer() {
  const modelViewer = document.getElementById('bot-model-viewer');
  if (modelViewer) {
    modelViewer.addEventListener('click', () => {
      triggerMainMic();
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
      showThoughtBubble('Escuchando tus síntomas...', 0);
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

  recognition.onerror = (event) => {
    stopRecording();
    if (event?.error === 'not-allowed') showToast('Permiso de micrófono no otorgado');
  };

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

function triggerMainMic() {
  const chatDrawer = document.getElementById('chat-drawer');
  if (chatDrawer && chatDrawer.classList.contains('open')) {
    showToast('Cierra el chat para usar el micrófono principal.');
    return;
  }
  if (!recognition) {
    showToast('El reconocimiento de voz no está soportado.');
    return;
  }
  stopSpeech();
  if (isMainRecording || isChatRecording) {
    try { recognition.stop(); } catch(e) {}
    stopRecording();
  } else {
    activeRecordingSource = 'main';
    try {
      recognition.start();
    } catch (e) {
      try { recognition.stop(); } catch(err) {}
      setTimeout(() => {
        try { recognition.start(); } catch(err2) {}
      }, 150);
    }
  }
}

function setupEventListeners() {
  const btnToggleSpeech = document.getElementById('btn-toggle-speech');
  if (btnToggleSpeech) {
    btnToggleSpeech.addEventListener('click', () => {
      mainSpeechEnabled = !mainSpeechEnabled;
      btnToggleSpeech.classList.toggle('active', mainSpeechEnabled);
      if (!mainSpeechEnabled) stopSpeech();
      showToast(mainSpeechEnabled ? 'Voz de lectura activada' : 'Voz de lectura desactivada');
    });
  }

  const btnChatToggleSpeech = document.getElementById('btn-chat-toggle-speech');
  if (btnChatToggleSpeech) {
    btnChatToggleSpeech.addEventListener('click', () => {
      chatSpeechEnabled = !chatSpeechEnabled;
      btnChatToggleSpeech.classList.toggle('active', chatSpeechEnabled);
      if (!chatSpeechEnabled) stopSpeech();
      showToast(chatSpeechEnabled ? 'Voz de chat activada' : 'Voz de chat desactivada');
    });
  }

  const btnClearChat = document.getElementById('btn-clear-chat');
  if (btnClearChat) {
    btnClearChat.addEventListener('click', () => {
      sessionStorage.removeItem('ia_agent_medical_messages');
      chatHistory = [];
      const chatMessages = document.getElementById('chat-messages');
      if (chatMessages) {
        chatMessages.innerHTML = '<div class="chat-msg ai">¡Hola! Soy tu Asistente Médico. Describe tus síntomas o molestias físicas para orientarte de forma segura.</div>';
      }
      showToast('Consulta médica reiniciada');
    });
  }

  const btnMic = document.getElementById('btn-mic');
  if (btnMic) btnMic.addEventListener('click', triggerMainMic);

  const btnChatMic = document.getElementById('btn-chat-mic');
  if (btnChatMic) {
    btnChatMic.addEventListener('click', () => {
      if (!recognition) return showToast('Reconocimiento de voz no soportado');
      stopSpeech();
      activeRecordingSource = 'chat';
      try { recognition.start(); } catch(e) {}
    });
  }

  const btnChatToggle = document.getElementById('btn-chat-toggle');
  const btnCloseChat = document.getElementById('btn-close-chat');
  const chatDrawer = document.getElementById('chat-drawer');

  if (btnChatToggle && chatDrawer) {
    btnChatToggle.addEventListener('click', () => {
      chatDrawer.classList.toggle('open');
      if (chatDrawer.classList.contains('open')) hideThoughtBubble();
    });
  }

  if (btnCloseChat && chatDrawer) {
    btnCloseChat.addEventListener('click', () => {
      chatDrawer.classList.remove('open');
    });
  }

  const btnSendChat = document.getElementById('btn-send-chat');
  const chatInput = document.getElementById('chat-input');

  if (btnSendChat && chatInput) {
    const send = () => {
      const text = chatInput.value.trim();
      if (text) {
        chatInput.value = '';
        handleUserInput(text, false, true);
      }
    };
    btnSendChat.addEventListener('click', send);
    chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') send();
    });
  }
}

async function handleUserInput(text, isVoice = false, fromChat = false) {
  if (!text) return;

  appendChatMessage(text, 'user');
  chatHistory.push({ role: 'user', content: text });

  const chatDrawer = document.getElementById('chat-drawer');
  const isChatOpen = fromChat || (chatDrawer && chatDrawer.classList.contains('open'));

  const chatLoadingElem = showChatLoading();
  if (!isChatOpen) showThoughtBubbleLoading();
  else hideThoughtBubble();

  try {
    const edgeUrl = `${SUPABASE_URL}/functions/v1/${MEDICAL_EDGE_FUNCTION}`;
    const payload = {
      prompt: text,
      history: chatHistory.slice(-8)
    };

    const edgeResponse = await fetch(edgeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify(payload)
    });

    let aiReply = 'Entendido. Para orientarte mejor, ¿desde cuándo sientes este malestar?';

    if (edgeResponse.ok) {
      const resData = await edgeResponse.json();
      if (resData && resData.reply) aiReply = resData.reply;
    }

    stopThoughtBubbleLoading();
    removeChatLoading(chatLoadingElem);

    if (!isChatOpen) showThoughtBubble(aiReply, 8000);
    else hideThoughtBubble();

    appendChatMessage(aiReply, 'ai');
    chatHistory.push({ role: 'assistant', content: aiReply });

    const allowVoice = isChatOpen ? chatSpeechEnabled : mainSpeechEnabled;
    if (allowVoice && aiReply) {
      await speakResponse(aiReply);
    }

  } catch (err) {
    stopThoughtBubbleLoading();
    removeChatLoading(chatLoadingElem);
    const errText = 'Ocurrió una interrupción al consultar al asistente médico. Por favor intenta de nuevo.';
    if (!isChatOpen) showThoughtBubble(errText, 4000);
    appendChatMessage(errText, 'ai');
  }
}

function showThoughtBubbleLoading() {
  const container = document.querySelector('.thought-bubble-container');
  const thoughtText = document.getElementById('thought-text');
  stopThoughtBubbleLoading();
  let step = 0;
  const dots = ['Analizando...', 'Analizando. .', 'Analizando. . .'];
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

function showThoughtBubble(text, autoHideMs = 4000) {
  stopThoughtBubbleLoading();
  const container = document.querySelector('.thought-bubble-container');
  const thoughtText = document.getElementById('thought-text');
  if (thoughtText) thoughtText.innerText = text;
  if (container) container.classList.remove('hidden');
  if (thoughtBubbleTimer) clearTimeout(thoughtBubbleTimer);
  if (autoHideMs > 0) {
    thoughtBubbleTimer = setTimeout(() => hideThoughtBubble(), autoHideMs);
  }
}

function hideThoughtBubble() {
  stopThoughtBubbleLoading();
  const container = document.querySelector('.thought-bubble-container');
  if (container) container.classList.add('hidden');
}

function showChatLoading() {
  const chatMessages = document.getElementById('chat-messages');
  if (!chatMessages) return null;
  const loadingDiv = document.createElement('div');
  loadingDiv.className = 'chat-msg ai loading-msg';
  loadingDiv.id = 'chat-loading-indicator';
  const textP = document.createElement('p');
  textP.innerText = 'Analizando síntomas...';
  loadingDiv.appendChild(textP);
  chatMessages.appendChild(loadingDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return loadingDiv;
}

function removeChatLoading(elem) {
  if (elem && elem.parentNode) elem.parentNode.removeChild(elem);
  const existing = document.getElementById('chat-loading-indicator');
  if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
}

function appendChatMessage(text, sender, saveToSession = true) {
  const chatMessages = document.getElementById('chat-messages');
  if (!chatMessages) return;

  const msgDiv = document.createElement('div');
  msgDiv.className = `chat-msg ${sender}`;

  const textP = document.createElement('p');
  textP.innerText = text;
  msgDiv.appendChild(textP);

  chatMessages.appendChild(msgDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  if (saveToSession) {
    try {
      const raw = sessionStorage.getItem('ia_agent_medical_messages');
      let msgs = raw ? JSON.parse(raw) : [];
      msgs.push({ text, sender });
      if (msgs.length > 30) msgs = msgs.slice(-30);
      sessionStorage.setItem('ia_agent_medical_messages', JSON.stringify(msgs));
    } catch (e) {}
  }
}

async function speakResponse(text) {
  stopSpeech();
  const cleanText = (text || '').replace(/[*_#`~]/g, '').trim();
  if (!cleanText) return;

  let voiceSettings = null;
  try {
    const raw = localStorage.getItem('ia_agent_voice_settings');
    if (raw) voiceSettings = JSON.parse(raw);
  } catch (e) {}

  let voiceId = (voiceSettings && (voiceSettings.voice_id_es || voiceSettings.voice_id)) || '';

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
          currentElevenAudio = null;
        };

        currentElevenAudio.play().catch(() => {
          if (scene3D) scene3D.setSpeakingState(false);
        });
      }
    }
  } catch (e) {
    if (scene3D) scene3D.setSpeakingState(false);
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
