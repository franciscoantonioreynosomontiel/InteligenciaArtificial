// Real-Time Translator Module (docs/js/traductor.js)
const SUPABASE_URL = 'https://qqjhadwxboeichxtxree.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFxamhhZHd4Ym9laWNoeHR4cmVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4NDY4ODAsImV4cCI6MjA5NTQyMjg4MH0.dM1VaV-lDPxoPlOHGAIbgfCSE3RMdURcVubq8tTs6yQ';
const TRANSLATE_FUNCTION_NAME = 'traductor';

export class RealtimeTranslator {
  constructor() {
    this.isActive = false;
    this.recognition = null;
    this.synth = window.speechSynthesis;
    this.btnTranslate = null;
    this.translatorCard = null;
    this.translatorStatusText = null;
    this.translatorLog = null;
    this.currentAudio = null;
    this.isProcessing = false;
  }

  init() {
    this.btnTranslate = document.getElementById('btn-translate');
    this.translatorCard = document.getElementById('translator-card');
    this.translatorStatusText = document.getElementById('translator-status-text');
    this.translatorLog = document.getElementById('translator-log');

    if (this.btnTranslate) {
      this.btnTranslate.addEventListener('click', () => this.toggleTranslation());
    }

    this.setupRecognition();
  }

  setupRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('SpeechRecognition not supported in this browser.');
      return;
    }

    this.recognition = new SpeechRecognition();
    // Continuous multi-lang listening mode
    this.recognition.continuous = true;
    this.recognition.interimResults = false;
    this.recognition.lang = 'en-US'; // Broad recognition for bilingual stream

    this.recognition.onstart = () => {
      console.log('RealtimeTranslator: Speech recognition started');
      this.updateStatus('🔴 Traductor activo', 'active');
    };

    this.recognition.onresult = async (event) => {
      if (!this.isActive || this.isProcessing) return;

      const results = event.results;
      const lastResultIndex = results.length - 1;
      const transcript = results[lastResultIndex][0].transcript.trim();

      if (transcript.length > 1) {
        await this.handleSpeechInput(transcript);
      }
    };

    this.recognition.onerror = (event) => {
      console.warn('RealtimeTranslator recognition error:', event.error);
      if (this.isActive && event.error !== 'no-speech') {
        setTimeout(() => this.restartRecognition(), 300);
      }
    };

    this.recognition.onend = () => {
      if (this.isActive) {
        this.restartRecognition();
      }
    };
  }

  restartRecognition() {
    if (!this.isActive || !this.recognition) return;
    try {
      this.recognition.start();
    } catch (e) {
      // Already running or starting
    }
  }

  toggleTranslation() {
    if (this.isActive) {
      this.stopTranslation();
    } else {
      this.startTranslation();
    }
  }

  startTranslation() {
    if (!this.recognition) {
      this.showToast('El reconocimiento de voz no está soportado en este navegador.');
      return;
    }

    this.isActive = true;
    if (this.btnTranslate) {
      this.btnTranslate.classList.add('active');
      this.btnTranslate.innerHTML = `<span>🔴 Traductor activo</span>`;
    }

    if (this.translatorCard) {
      this.translatorCard.classList.add('active');
    }

    this.updateStatus('🔴 Traductor activo - Escuchando...', 'active');
    this.addLogMessage('system', 'Sesión de traducción iniciada.');

    try {
      this.recognition.start();
    } catch (e) {
      console.warn('Recognition already started:', e);
    }
  }

  stopTranslation() {
    this.isActive = false;
    this.isProcessing = false;

    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (e) {}
    }

    if (this.synth) {
      this.synth.cancel();
    }

    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio = null;
    }

    if (this.btnTranslate) {
      this.btnTranslate.classList.remove('active');
      this.btnTranslate.innerHTML = `<span>🎙️ Traducir</span>`;
    }

    if (this.translatorCard) {
      this.translatorCard.classList.remove('active');
    }

    this.updateStatus('Traductor detenido', 'stopped');
    this.addLogMessage('system', 'Traducción detenida.');
  }

  updateStatus(text, stateClass) {
    if (this.translatorStatusText) {
      this.translatorStatusText.textContent = text;
      this.translatorStatusText.className = `translator-status-text ${stateClass}`;
    }
  }

  addLogMessage(type, text) {
    if (!this.translatorLog) return;

    const entry = document.createElement('div');
    entry.className = `translator-log-entry ${type}`;
    entry.textContent = text;

    this.translatorLog.appendChild(entry);
    this.translatorLog.scrollTop = this.translatorLog.scrollHeight;
  }

  async handleSpeechInput(inputText) {
    this.isProcessing = true;
    this.addLogMessage('input', `Escuchado: "${inputText}"`);

    try {
      // Temporarily pause recognition while processing translation to prevent feedback loops
      try { this.recognition.stop(); } catch (e) {}

      const translationData = await this.callTranslationEdgeFunction(inputText);

      if (translationData && translationData.translated_text) {
        const detected = translationData.detected_lang || 'en';
        const target = translationData.target_lang || 'es';
        const translated = translationData.translated_text;

        this.addLogMessage('output', `[${detected.toUpperCase()} ➔ ${target.toUpperCase()}] ${translated}`);

        // Audio Output Routing
        if (translationData.audio_base64) {
          await this.playAudioBase64(translationData.audio_base64);
        } else {
          await this.speakTextWebSpeech(translated, target);
        }
      }
    } catch (err) {
      console.error('Error in handleSpeechInput:', err);
      this.addLogMessage('error', 'Error en la traducción.');
    } finally {
      this.isProcessing = false;
      if (this.isActive) {
        setTimeout(() => this.restartRecognition(), 400);
      }
    }
  }

  async callTranslationEdgeFunction(text) {
    const edgeUrl = `${SUPABASE_URL}/functions/v1/${TRANSLATE_FUNCTION_NAME}`;

    try {
      const res = await fetch(edgeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify({ text })
      });

      if (res.ok) {
        return await res.json();
      } else {
        // Fallback local translation logic if edge function endpoint is not yet deployed
        return this.localTranslationFallback(text);
      }
    } catch (e) {
      console.warn('Edge function fetch failed, using client fallback translation:', e);
      return this.localTranslationFallback(text);
    }
  }

  localTranslationFallback(text) {
    const isEnglish = /[a-zA-Z]/.test(text) && !/[áéíóúñ¿¡]/i.test(text);
    const detected = isEnglish ? 'en' : 'es';
    const target = isEnglish ? 'es' : 'en';

    return {
      original_text: text,
      detected_lang: detected,
      target_lang: target,
      translated_text: text, // Direct echo fallback if offline
      audio_base64: null
    };
  }

  playAudioBase64(base64Data) {
    return new Promise((resolve) => {
      if (this.currentAudio) {
        this.currentAudio.pause();
      }
      this.currentAudio = new Audio(`data:audio/mp3;base64,${base64Data}`);
      this.currentAudio.onended = () => resolve();
      this.currentAudio.onerror = () => resolve();
      this.currentAudio.play().catch(() => resolve());
    });
  }

  speakTextWebSpeech(text, langCode) {
    return new Promise((resolve) => {
      if (!this.synth) return resolve();

      this.synth.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = langCode === 'en' ? 'en-US' : 'es-ES';
      utterance.rate = 1.0;
      utterance.pitch = 1.0;

      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();

      this.synth.speak(utterance);
    });
  }

  showToast(msg) {
    const toast = document.createElement('div');
    toast.className = 'toast-msg';
    toast.innerText = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
  }
}
