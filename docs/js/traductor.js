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
      if (event.error !== 'aborted' && event.error !== 'no-speech') {
        this.addLogMessage('error', 'Error capturando audio. Reintentando...');
      }
    };

    this.recognition.onend = () => {
      if (this.isActive && !this.isProcessing) {
        try {
          this.recognition.start();
        } catch (e) {}
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
    if (!this.isActive) return;
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
          this.updateStatus('Reproduciendo voz...', 'active');
          await this.playAudioBase64(translationData.audio_base64);
        } else {
          this.updateStatus('Reproduciendo voz...', 'active');
          await this.fallbackBrowserSpeech(translated, targetLang);
        }
      } else if (translationData && translationData.error) {
        this.addLogMessage('error', translationData.error);
      }
    } catch (err) {
      console.error('Error in handleSpeechInput:', err);
      this.addLogMessage('error', 'Error en la traducción.');
    } finally {
      this.isProcessing = false;
      if (this.isActive) {
        const statusText = mode === 'hablar' ? 'Habla en español...' : 'Escuchando en inglés...';
        this.updateStatus(statusText, 'active');
        try {
          this.recognition.start();
        } catch (e) {}
      }
    }
  }

  async callTranslationEdgeFunction(text, sourceLang, targetLang) {
    const edgeUrl = `${SUPABASE_URL}/functions/v1/${TRANSLATE_FUNCTION_NAME}`;

    let voiceId = null;
    try {
      const raw = localStorage.getItem('ia_agent_voice_settings');
      if (raw) {
        const settings = JSON.parse(raw);
        if (settings) {
          voiceId = settings.voice_id || settings.voice_id_es || settings.voice_id_en || null;
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
          voice_id: voiceId
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (data && data.translated_text) return data;
      }
    } catch (e) {
      console.warn('Primary traductor function fetch error:', e);
    }

    // Robust Fallback: call gemini-chat endpoint for translation if primary traductor endpoint returns 404/500/error
    try {
      const geminiUrl = `${SUPABASE_URL}/functions/v1/gemini-chat`;
      const prompt = `Eres un traductor en tiempo real. Traduce la siguiente frase estrictamente de ${sourceLang === 'es' ? 'Español' : 'Inglés'} a ${targetLang === 'es' ? 'Español' : 'Inglés'}. Responde ÚNICAMENTE con el texto traducido final sin comillas, introducciones ni explicaciones.\n\nTexto: "${text}"`;

      const res = await fetch(geminiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify({ prompt })
      });

      if (res.ok) {
        const geminiData = await res.json();
        let translatedText = (geminiData.reply || '').replace(/[*_#`~]/g, '').trim();

        if (translatedText) {
          let audioBase64 = null;
          if (voiceId) {
            try {
              const vozRes = await fetch(`${SUPABASE_URL}/functions/v1/voz`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
                },
                body: JSON.stringify({
                  action: 'text_to_speech',
                  text: translatedText,
                  voice_id: voiceId
                })
              });

              if (vozRes.ok) {
                const vozData = await vozRes.json();
                audioBase64 = vozData.audio_base64 || null;
              }
            } catch (vErr) {}
          }

          return {
            original_text: text,
            detected_lang: sourceLang,
            target_lang: targetLang,
            translated_text: translatedText,
            audio_base64: audioBase64
          };
        }
      }
    } catch (gErr) {
      console.warn('Gemini translation fallback error:', gErr);
    }

    return this.localTranslationFallback(text, sourceLang, targetLang);
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
        try { this.currentAudio.pause(); } catch(e) {}
      }
      this.currentAudio = new Audio(`data:audio/mp3;base64,${base64Data}`);
      this.currentAudio.onended = () => resolve();
      this.currentAudio.onerror = (e) => {
        console.warn('Audio playback error:', e);
        resolve();
      };
      const playPromise = this.currentAudio.play();
      if (playPromise !== undefined) {
        playPromise.catch((err) => {
          console.warn('Audio play prevented or failed:', err);
          resolve();
        });
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
