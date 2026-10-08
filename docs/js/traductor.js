// Real-Time Translator Module (docs/js/traductor.js)
const SUPABASE_URL = 'https://qqjhadwxboeichxtxree.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFxamhhZHd4Ym9laWNoeHR4cmVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4NDY4ODAsImV4cCI6MjA5NTQyMjg4MH0.dM1VaV-lDPxoPlOHGAIbgfCSE3RMdURcVubq8tTs6yQ';
const TRANSLATE_FUNCTION_NAME = 'traductor';

export class RealtimeTranslator {
  constructor() {
    this.isActive = false;
    this.currentMode = null; // 'hablar' (es -> en) or 'escuchar' (en -> es)
    this.recognition = null;
    this.synth = window.speechSynthesis;
    this.btnHablar = null;
    this.btnEscuchar = null;
    this.translatorCard = null;
    this.translatorStatusText = null;
    this.translatorLog = null;
    this.currentAudio = null;
    this.isProcessing = false;
  }

  init() {
    this.btnHablar = document.getElementById('btn-hablar');
    this.btnEscuchar = document.getElementById('btn-escuchar');
    this.translatorCard = document.getElementById('translator-card');
    this.translatorStatusText = document.getElementById('translator-status-text');
    this.translatorLog = document.getElementById('translator-log');

    if (this.btnHablar) {
      this.btnHablar.addEventListener('click', () => this.toggleMode('hablar'));
    }
    if (this.btnEscuchar) {
      this.btnEscuchar.addEventListener('click', () => this.toggleMode('escuchar'));
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
    this.recognition.continuous = false; // Single-shot utterance for fast response
    this.recognition.interimResults = false;

    this.recognition.onstart = () => {
      console.log('RealtimeTranslator: Speech recognition started in mode:', this.currentMode);
      if (this.currentMode === 'hablar') {
        this.updateStatus('Habla en español...', 'active');
      } else if (this.currentMode === 'escuchar') {
        this.updateStatus('Escuchando en inglés...', 'active');
      }
    };

    this.recognition.onresult = async (event) => {
      if (!this.isActive || this.isProcessing) return;

      const results = event.results;
      const lastResultIndex = results.length - 1;
      const transcript = results[lastResultIndex][0].transcript.trim();

      if (transcript.length > 0) {
        await this.handleSpeechInput(transcript);
      }
    };

    this.recognition.onerror = (event) => {
      console.warn('RealtimeTranslator recognition error:', event.error);
      this.stopTranslation();
      if (event.error !== 'aborted') {
        this.addLogMessage('error', 'Error capturando audio. Intenta de nuevo.');
      }
    };

    this.recognition.onend = () => {
      if (this.isActive && !this.isProcessing) {
        this.stopTranslation();
      }
    };
  }

  toggleMode(mode) {
    if (this.isActive && this.currentMode === mode) {
      this.stopTranslation();
    } else {
      this.startMode(mode);
    }
  }

  startMode(mode) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      this.showToast('El reconocimiento de voz no está soportado en este navegador.');
      return;
    }

    this.stopTranslation();

    this.isActive = true;
    this.currentMode = mode;

    if (this.btnHablar) this.btnHablar.classList.remove('active');
    if (this.btnEscuchar) this.btnEscuchar.classList.remove('active');

    if (mode === 'hablar') {
      if (this.btnHablar) this.btnHablar.classList.add('active');
      this.recognition.lang = 'es-ES';
      this.addLogMessage('system', 'Modo "Hablar" activo (Español -> Inglés).');
    } else {
      if (this.btnEscuchar) this.btnEscuchar.classList.add('active');
      this.recognition.lang = 'en-US';
      this.addLogMessage('system', 'Modo "Escuchar" activo (Inglés -> Español).');
    }

    if (this.translatorCard) {
      this.translatorCard.classList.add('active');
    }

    try {
      this.recognition.start();
    } catch (e) {
      console.warn('Recognition start error:', e);
    }
  }

  stopTranslation() {
    this.isActive = false;
    this.isProcessing = false;
    this.currentMode = null;

    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (e) {}
    }

    if (this.synth) {
      this.synth.cancel();
    }

    if (this.btnHablar) this.btnHablar.classList.remove('active');
    if (this.btnEscuchar) this.btnEscuchar.classList.remove('active');

    this.updateStatus('Traductor detenido', 'stopped');
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
    const mode = this.currentMode || 'hablar';
    const sourceLang = mode === 'hablar' ? 'es' : 'en';
    const targetLang = mode === 'hablar' ? 'en' : 'es';

    this.addLogMessage('input', `Escuchado (${sourceLang.toUpperCase()}): "${inputText}"`);
    this.updateStatus('Traduciendo...', 'active');

    try {
      try { this.recognition.stop(); } catch (e) {}

      const translationData = await this.callTranslationEdgeFunction(inputText, sourceLang, targetLang);

      if (translationData && translationData.translated_text) {
        const translated = translationData.translated_text;
        this.addLogMessage('output', `Traducción (${targetLang.toUpperCase()}): "${translated}"`);

        if (translationData.audio_base64) {
          await this.playAudioBase64(translationData.audio_base64);
        } else {
          await this.fallbackBrowserSpeech(translated, targetLang);
        }
      }
    } catch (err) {
      console.error('Error in handleSpeechInput:', err);
      this.addLogMessage('error', 'Error en la traducción.');
    } finally {
      this.stopTranslation();
    }
  }

  async callTranslationEdgeFunction(text, sourceLang, targetLang) {
    const edgeUrl = `${SUPABASE_URL}/functions/v1/${TRANSLATE_FUNCTION_NAME}`;

    let voiceIdEs = null;
    let voiceIdEn = null;
    try {
      const raw = localStorage.getItem('ia_agent_voice_settings');
      if (raw) {
        const settings = JSON.parse(raw);
        if (settings) {
          voiceIdEs = settings.voice_id_es || settings.voice_id || null;
          voiceIdEn = settings.voice_id_en || settings.voice_id || null;
        }
      }
    } catch (e) {}

    try {
      const res = await fetch(edgeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify({
          text,
          source_lang: sourceLang,
          target_lang: targetLang,
          voice_id_es: voiceIdEs,
          voice_id_en: voiceIdEn,
          voice_id: targetLang === 'en' ? voiceIdEn : voiceIdEs
        })
      });

      if (res.ok) {
        return await res.json();
      } else {
        return this.localTranslationFallback(text, sourceLang, targetLang);
      }
    } catch (e) {
      return this.localTranslationFallback(text, sourceLang, targetLang);
    }
  }

  localTranslationFallback(text, sourceLang, targetLang) {
    const cleanText = text.trim();
    let translated = cleanText;

    if (sourceLang === 'es' && targetLang === 'en') {
      translated = cleanText
        .replace(/\bhola\b/gi, 'hello')
        .replace(/\bcómo estás\b/gi, 'how are you')
        .replace(/\bcomo estas\b/gi, 'how are you')
        .replace(/\bgracias\b/gi, 'thank you')
        .replace(/\badiós\b/gi, 'goodbye')
        .replace(/\badios\b/gi, 'goodbye');
    } else {
      translated = cleanText
        .replace(/\bhello\b/gi, 'hola')
        .replace(/\bhi\b/gi, 'hola')
        .replace(/\bhow are you\b/gi, 'cómo estás')
        .replace(/\bthank you\b/gi, 'gracias')
        .replace(/\bthanks\b/gi, 'gracias')
        .replace(/\bgoodbye\b/gi, 'adiós')
        .replace(/\bbye\b/gi, 'adiós');
    }

    return {
      original_text: cleanText,
      detected_lang: sourceLang,
      target_lang: targetLang,
      translated_text: translated,
      audio_base64: null
    };
  }

  fallbackBrowserSpeech(text, targetLang) {
    return new Promise((resolve) => {
      if (!this.synth) return resolve();
      this.synth.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = targetLang === 'en' ? 'en-US' : 'es-ES';
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      this.synth.speak(utterance);
    });
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


  showToast(msg) {
    const toast = document.createElement('div');
    toast.className = 'toast-msg';
    toast.innerText = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
  }
}
