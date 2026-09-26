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

document.addEventListener('DOMContentLoaded', () => {
  // 1. Setup 3D Model Viewer & Three.js Fallback
  setup3DViewer();

  // 2. Setup Speech Recognition
  setupSpeechRecognition();

  // 3. Setup UI Event Listeners
  setupEventListeners();
});

function setup3DViewer() {
  const modelViewer = document.getElementById('bot-model-viewer');

  if (modelViewer) {
    // Prevent default jump/tap animations on click, open chat drawer instead
    modelViewer.addEventListener('click', (e) => {
      // Open chat drawer when clicking on the model viewer character
      const chatDrawer = document.getElementById('chat-drawer');
      if (chatDrawer) {
        chatDrawer.classList.add('open');
      }
    });

    // Handle error loading GLTF (if file is placeholder or corrupt) -> fallback to Three.js procedurally generated character
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
    updateThoughtBubble('Escuchando... Háblame 🎙️');
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
      btnToggleSpeech.innerText = speechEnabled ? '🔊' : '🔇';
      showToast(speechEnabled ? 'Voz activada' : 'Voz desactivada');
    });
  }

  // Voice Mic Button
  const btnMic = document.getElementById('btn-mic');
  if (btnMic) {
    btnMic.addEventListener('click', () => {
      if (!recognition) {
        showToast('El reconocimiento de voz no está soportado en este navegador.');
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
      updateThoughtBubble('Foto capturada 📸. Escríbeme o háblame para preguntarme sobre ella.');
      showToast('Foto cargada para análisis');
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
  updateThoughtBubble('Pensando... 🤔');

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
    const errorMsg = 'Lo siento, ocurrió un pequeño error. Por favor intenta de nuevo.';
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
  utterance.pitch = 1.1; // Slightly sweet/friendly pitch

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
