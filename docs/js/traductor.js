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
    this.currentLangIndex = 0;
    this.supportedLangs = ['es-ES', 'en-US']; // Alternating recognition languages
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
    this.recognition.continuous = true;
    this.recognition.interimResults = false;
    this.recognition.lang = 'es-ES';

    this.recognition.onstart = () => {
      console.log('RealtimeTranslator: Speech recognition started');
      this.updateStatus('Traductor activo - Escuchando...', 'active');
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
      if (this.isActive && event.error !== 'no-speech' && !this.isProcessing) {
        setTimeout(() => this.restartRecognition(), 300);
      }
    };

    this.recognition.onend = () => {
      if (this.isActive && !this.isProcessing) {
        this.restartRecognition();
      }
    };
  }

  restartRecognition() {
    if (!this.isActive || !this.recognition) return;
    try {
      this.recognition.start();
    } catch (e) {}
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
      this.btnTranslate.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
        <span>Traductor activo</span>
      `;
    }

    if (this.translatorCard) {
      this.translatorCard.classList.add('active');
    }

    this.updateStatus('Traductor activo - Escuchando...', 'active');
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
      this.btnTranslate.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
        <span>Traducir</span>
      `;
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
      try { this.recognition.stop(); } catch (e) {}

      const translationData = await this.callTranslationEdgeFunction(inputText);

      if (translationData && translationData.translated_text) {
        const detected = translationData.detected_lang || 'en';
        const target = translationData.target_lang || 'es';
        const translated = translationData.translated_text;

        this.addLogMessage('output', `[${detected.toUpperCase()} -> ${target.toUpperCase()}] ${translated}`);

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

    let voiceId = null;
    try {
      const raw = localStorage.getItem('ia_agent_voice_settings');
      if (raw) {
        const settings = JSON.parse(raw);
        if (settings && settings.voice_id) voiceId = settings.voice_id;
      }
    } catch (e) {}

    try {
      const res = await fetch(edgeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify({ text, voice_id: voiceId })
      });

      if (res.ok) {
        return await res.json();
      } else {
        return this.localTranslationFallback(text);
      }
    } catch (e) {
      return this.localTranslationFallback(text);
    }
  }

  localTranslationFallback(text) {
    const cleanText = text.trim();
    const lowerText = cleanText.toLowerCase();

    const englishWords = ['hello', 'hi', 'hey', 'good morning', 'good afternoon', 'good evening', 'how are you', 'what is your name', 'thank you', 'thanks', 'bye', 'goodbye', 'yes', 'no', 'please', 'help'];
    const isExplicitEnglish = englishWords.some((w) => lowerText.includes(w)) || (/[a-zA-Z]/.test(cleanText) && !/[áéíóúñ¿¡]/i.test(cleanText));

    const detected = isExplicitEnglish ? 'en' : 'es';
    const target = isExplicitEnglish ? 'es' : 'en';

    const dictionary = {
      'hello': '¡Hola!',
      'hi': '¡Hola!',
      'hey': '¡Hola!',
      'good morning': 'Buenos días',
      'good afternoon': 'Buenas tardes',
      'good evening': 'Buenas noches',
      'how are you': '¿Cómo estás?',
      'how are you?': '¿Cómo estás?',
      'what is your name': '¿Cuál es tu nombre?',
      'thank you': 'Muchas gracias',
      'thanks': 'Gracias',
      'bye': '¡Adiós!',
      'goodbye': '¡Hasta luego!',
      'yes': 'Sí',
      'no': 'No',
      'please': 'Por favor',
      'hola': 'Hello!',
      'buenos dias': 'Good morning!',
      'buenos días': 'Good morning!',
      'buenas tardes': 'Good afternoon!',
      'buenas noches': 'Good evening!',
      'como estas': 'How are you?',
      'cómo estás': 'How are you?',
      'gracias': 'Thank you!',
      'muchas gracias': 'Thank you very much!',
      'adios': 'Goodbye!',
      'adiós': 'Goodbye!',
      'por favor': 'Please'
    };

    let translated = dictionary[lowerText];

    if (!translated) {
      if (detected === 'en') {
        translated = cleanText
          .replace(/\bhello\b/gi, 'hola')
          .replace(/\bhi\b/gi, 'hola')
          .replace(/\bhow are you\b/gi, 'cómo estás')
          .replace(/\bthank you\b/gi, 'gracias')
          .replace(/\bthanks\b/gi, 'gracias')
          .replace(/\bgoodbye\b/gi, 'adiós')
          .replace(/\bbye\b/gi, 'adiós');
      } else {
        translated = cleanText
          .replace(/\bhola\b/gi, 'hello')
          .replace(/\bcómo estás\b/gi, 'how are you')
          .replace(/\bcomo estas\b/gi, 'how are you')
          .replace(/\bgracias\b/gi, 'thank you')
          .replace(/\badiós\b/gi, 'goodbye')
          .replace(/\badios\b/gi, 'goodbye');
      }
    }

    return {
      original_text: cleanText,
      detected_lang: detected,
      target_lang: target,
      translated_text: translated,
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
      const targetLang = langCode === 'en' ? 'en-US' : 'es-ES';
      utterance.lang = targetLang;
      utterance.rate = 1.0;
      utterance.pitch = 1.0;

      const voices = this.synth.getVoices();
      if (voices && voices.length > 0) {
        const matchingVoice = voices.find((v) => v.lang.startsWith(langCode) || v.lang.replace('_', '-').startsWith(targetLang));
        if (matchingVoice) {
          utterance.voice = matchingVoice;
        }
      }

      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();

      try {
        if (this.synth.paused) this.synth.resume();
        this.synth.speak(utterance);
      } catch (e) {
        resolve();
      }
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
