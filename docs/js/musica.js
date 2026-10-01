// Music Player Controller & Gemini GLTF Direct Voice Interaction
import { Scene3D } from './three-scene.js';
import { processGeminiRequest } from './gemini.js';

// Cloudinary Music Catalog Configuration
const CLOUDINARY_BASE_URL = 'https://res.cloudinary.com/dp776nphp/video/upload/v1/ia_agent/music/';

const MUSIC_LIBRARY = [
  {
    id: 'track-1',
    title: 'Melodía Chill Vibes',
    artist: 'Amigo Gemini',
    album: 'Atardeceres Suaves',
    url: `${CLOUDINARY_BASE_URL}chill_vibes.mp3`,
    cover: './assets/img/logopwa.png',
    duration: '03:15'
  },
  {
    id: 'track-2',
    title: 'Ritmo Urbano Latino',
    artist: 'Amigo Gemini',
    album: 'Fiesta Nocturna',
    url: `${CLOUDINARY_BASE_URL}ritmo_urbano.mp3`,
    cover: './assets/img/logopwa.png',
    duration: '02:45'
  },
  {
    id: 'track-3',
    title: 'Acústico Romántico',
    artist: 'Voz Dulce',
    album: 'Atardeceres Suaves',
    url: `${CLOUDINARY_BASE_URL}acustico_romantico.mp3`,
    cover: './assets/img/logopwa.png',
    duration: '03:40'
  },
  {
    id: 'track-4',
    title: 'Piano de Meditación',
    artist: 'Serenidad',
    album: 'Mente Clara',
    url: `${CLOUDINARY_BASE_URL}piano_meditacion.mp3`,
    cover: './assets/img/logopwa.png',
    duration: '04:10'
  },
  {
    id: 'track-5',
    title: 'Pop Electrónico',
    artist: 'Voz Dulce',
    album: 'Fiesta Nocturna',
    url: `${CLOUDINARY_BASE_URL}pop_electronico.mp3`,
    cover: './assets/img/logopwa.png',
    duration: '03:00'
  }
];

// Audio State
let audioPlayer = new Audio();
let currentTrackIndex = 0;
let isPlaying = false;
let isShuffle = false;
let isRepeat = false;
let activeFilterTab = 'songs'; // 'songs', 'albums', 'artists'
let searchFilterQuery = '';

// Speech & Voice State
let scene3D = null;
let speechEnabled = true;
let isListeningGLTF = false;
let recognition = null;
let currentElevenAudio = null;

const SUPABASE_URL = 'https://qqjhadwxboeichxtxree.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFxamhhZHd4Ym9laWNoeHR4cmVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4NDY4ODAsImV4cCI6MjA5NTQyMjg4MH0.dM1VaV-lDPxoPlOHGAIbgfCSE3RMdURcVubq8tTs6yQ';

document.addEventListener('DOMContentLoaded', () => {
  setup3DViewer();
  setupSpeechRecognition();
  setupAudioPlayerEvents();
  setupUIEventListeners();
  loadTrack(currentTrackIndex, false);
  renderLibraryList();
});

function setup3DViewer() {
  const modelViewer = document.getElementById('bot-model-viewer');
  if (modelViewer) {
    modelViewer.addEventListener('error', () => {
      modelViewer.style.display = 'none';
      scene3D = new Scene3D('canvas-container');
    });

    // GLTF Model Touch/Click Handler to trigger speech recognition directly
    modelViewer.addEventListener('click', handleGLTFTouch);
  } else if (document.getElementById('canvas-container')) {
    const fallbackCanvas = document.getElementById('canvas-container');
    if (fallbackCanvas) {
      fallbackCanvas.addEventListener('click', handleGLTFTouch);
      scene3D = new Scene3D('canvas-container');
    }
  }
}

function handleGLTFTouch() {
  if (!recognition) {
    showToast('El reconocimiento de voz no está soportado en este navegador.');
    return;
  }

  if (isListeningGLTF) {
    recognition.stop();
  } else {
    stopElevenSpeech();
    try {
      recognition.start();
    } catch (e) {
      recognition.stop();
      setTimeout(() => recognition.start(), 200);
    }
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
    isListeningGLTF = true;
    updateGLTFBadge(true, 'Escuchando...');
    showThoughtBubble('Te escucho... Háblame para pedirme canciones o hacerme preguntas.');
  };

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    stopGLTFListening();
    handleGeminiVoiceCommand(transcript);
  };

  recognition.onerror = () => stopGLTFListening();
  recognition.onend = () => stopGLTFListening();
}

function stopGLTFListening() {
  isListeningGLTF = false;
  updateGLTFBadge(false, 'Tócame para hablar');
}

function updateGLTFBadge(isListening, text) {
  const badge = document.getElementById('gltf-badge');
  const badgeText = document.getElementById('gltf-badge-text');
  if (badge) badge.classList.toggle('listening', isListening);
  if (badgeText) badgeText.innerText = text;
}

async function handleGeminiVoiceCommand(userPrompt) {
  showThoughtBubbleLoading();

  try {
    // Pass user prompt with custom player context instructions
    const fullContextPrompt = `[Contexto Reproductor de Música]: El usuario está usando el reproductor de música. Si pide poner una canción, pausar, siguiente o cambiar de tema, ayúdale amablemente y responde de forma alegre y directa. Petición del usuario: "${userPrompt}"`;

    const responseText = await processGeminiRequest(fullContextPrompt);
    stopThoughtBubbleLoading();
    showThoughtBubble(responseText, 6000);

    // Dynamic music control based on voice request
    const lower = userPrompt.toLowerCase();
    if (lower.includes('reproducir') || lower.includes('pon') || lower.includes('play')) {
      const foundTrackIndex = MUSIC_LIBRARY.findIndex(t =>
        lower.includes(t.title.toLowerCase()) || lower.includes(t.artist.toLowerCase()) || lower.includes(t.album.toLowerCase())
      );
      if (foundTrackIndex !== -1) {
        loadTrack(foundTrackIndex, true);
      } else if (!isPlaying) {
        togglePlayPause();
      }
    } else if (lower.includes('pausa') || lower.includes('deten') || lower.includes('stop')) {
      if (isPlaying) togglePlayPause();
    } else if (lower.includes('siguiente') || lower.includes('cambia')) {
      playNextTrack();
    } else if (lower.includes('anterior')) {
      playPrevTrack();
    }

    if (speechEnabled && responseText) {
      speakResponse(responseText);
    }
  } catch (err) {
    stopThoughtBubbleLoading();
    showThoughtBubble('Ocurrió un error al procesar tu solicitud por voz.');
  }
}

// Audio Player Engine
function setupAudioPlayerEvents() {
  audioPlayer.volume = 0.8;

  audioPlayer.addEventListener('timeupdate', () => {
    if (!audioPlayer.duration) return;
    const seekSlider = document.getElementById('seek-slider');
    const currentTimeElem = document.getElementById('current-time');
    const totalTimeElem = document.getElementById('total-time');

    const progressPercent = (audioPlayer.currentTime / audioPlayer.duration) * 100;
    if (seekSlider) seekSlider.value = progressPercent || 0;

    if (currentTimeElem) currentTimeElem.innerText = formatTime(audioPlayer.currentTime);
    if (totalTimeElem) totalTimeElem.innerText = formatTime(audioPlayer.duration);
  });

  audioPlayer.addEventListener('ended', () => {
    if (isRepeat) {
      audioPlayer.currentTime = 0;
      audioPlayer.play();
    } else {
      playNextTrack();
    }
  });

  audioPlayer.addEventListener('error', () => {
    showToast('No se pudo cargar la canción de Cloudinary.');
    setIsPlaying(false);
  });
}

function loadTrack(index, autoPlay = true) {
  if (index < 0 || index >= MUSIC_LIBRARY.length) return;
  currentTrackIndex = index;
  const track = MUSIC_LIBRARY[currentTrackIndex];

  audioPlayer.src = track.url;

  const titleElem = document.getElementById('track-title');
  const artistElem = document.getElementById('track-artist');
  const coverElem = document.getElementById('track-cover');

  if (titleElem) titleElem.innerText = track.title;
  if (artistElem) artistElem.innerText = `${track.artist} • ${track.album}`;
  if (coverElem) coverElem.src = track.cover;

  renderLibraryList();

  if (autoPlay) {
    audioPlayer.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
  } else {
    setIsPlaying(false);
  }
}

function togglePlayPause() {
  if (isPlaying) {
    audioPlayer.pause();
    setIsPlaying(false);
  } else {
    audioPlayer.play().then(() => setIsPlaying(true)).catch(() => {
      showToast('Presiona de nuevo para reproducir audio.');
      setIsPlaying(false);
    });
  }
}

function setIsPlaying(playing) {
  isPlaying = playing;
  const iconPlay = document.getElementById('icon-play');
  const iconPause = document.getElementById('icon-pause');
  if (iconPlay && iconPause) {
    iconPlay.style.display = isPlaying ? 'none' : 'block';
    iconPause.style.display = isPlaying ? 'block' : 'none';
  }
}

function playNextTrack() {
  if (isShuffle) {
    let nextIndex = Math.floor(Math.random() * MUSIC_LIBRARY.length);
    if (nextIndex === currentTrackIndex) nextIndex = (currentTrackIndex + 1) % MUSIC_LIBRARY.length;
    loadTrack(nextIndex, true);
  } else {
    const nextIndex = (currentTrackIndex + 1) % MUSIC_LIBRARY.length;
    loadTrack(nextIndex, true);
  }
}

function playPrevTrack() {
  const prevIndex = (currentTrackIndex - 1 + MUSIC_LIBRARY.length) % MUSIC_LIBRARY.length;
  loadTrack(prevIndex, true);
}

function formatTime(seconds) {
  if (isNaN(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

// UI Event Listeners & Hamburger Drawer Logic
function setupUIEventListeners() {
  const btnHamburger = document.getElementById('btn-hamburger');
  const btnCloseMenu = document.getElementById('btn-close-menu');
  const hamburgerMenu = document.getElementById('hamburger-menu');

  if (btnHamburger && hamburgerMenu) {
    btnHamburger.addEventListener('click', () => hamburgerMenu.classList.add('open'));
  }

  if (btnCloseMenu && hamburgerMenu) {
    btnCloseMenu.addEventListener('click', () => hamburgerMenu.classList.remove('open'));
  }

  // Filter Tabs
  const tabSongs = document.getElementById('tab-songs');
  const tabAlbums = document.getElementById('tab-albums');
  const tabArtists = document.getElementById('tab-artists');

  const setTab = (tabName, elem) => {
    activeFilterTab = tabName;
    [tabSongs, tabAlbums, tabArtists].forEach(t => t?.classList.remove('active'));
    elem.classList.add('active');
    renderLibraryList();
  };

  if (tabSongs) tabSongs.addEventListener('click', () => setTab('songs', tabSongs));
  if (tabAlbums) tabAlbums.addEventListener('click', () => setTab('albums', tabAlbums));
  if (tabArtists) tabArtists.addEventListener('click', () => setTab('artists', tabArtists));

  // Search Input
  const searchInput = document.getElementById('music-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchFilterQuery = e.target.value.toLowerCase().trim();
      renderLibraryList();
    });
  }

  // Player Buttons
  const btnPlayPause = document.getElementById('btn-play-pause');
  const btnNext = document.getElementById('btn-next');
  const btnPrev = document.getElementById('btn-prev');
  const btnShuffle = document.getElementById('btn-shuffle');
  const btnRepeat = document.getElementById('btn-repeat');

  if (btnPlayPause) btnPlayPause.addEventListener('click', togglePlayPause);
  if (btnNext) btnNext.addEventListener('click', playNextTrack);
  if (btnPrev) btnPrev.addEventListener('click', playPrevTrack);

  if (btnShuffle) {
    btnShuffle.addEventListener('click', () => {
      isShuffle = !isShuffle;
      btnShuffle.classList.toggle('active', isShuffle);
      showToast(isShuffle ? 'Modo aleatorio activado' : 'Modo aleatorio desactivado');
    });
  }

  if (btnRepeat) {
    btnRepeat.addEventListener('click', () => {
      isRepeat = !isRepeat;
      btnRepeat.classList.toggle('active', isRepeat);
      showToast(isRepeat ? 'Modo repetir activado' : 'Modo repetir desactivado');
    });
  }

  // Seekbar & Volume
  const seekSlider = document.getElementById('seek-slider');
  if (seekSlider) {
    seekSlider.addEventListener('input', (e) => {
      if (audioPlayer.duration) {
        audioPlayer.currentTime = (e.target.value / 100) * audioPlayer.duration;
      }
    });
  }

  const volumeSlider = document.getElementById('volume-slider');
  if (volumeSlider) {
    volumeSlider.addEventListener('input', (e) => {
      audioPlayer.volume = parseFloat(e.target.value);
    });
  }

  // Speech Toggle
  const btnToggleSpeech = document.getElementById('btn-toggle-speech');
  if (btnToggleSpeech) {
    btnToggleSpeech.addEventListener('click', () => {
      speechEnabled = !speechEnabled;
      btnToggleSpeech.classList.toggle('active', speechEnabled);
      if (!speechEnabled) stopElevenSpeech();
      showToast(speechEnabled ? 'Voz activada' : 'Voz desactivada');
    });
  }
}

function renderLibraryList() {
  const container = document.getElementById('music-library-list');
  if (!container) return;

  container.innerHTML = '';

  let filteredTracks = MUSIC_LIBRARY.filter(track => {
    if (!searchFilterQuery) return true;
    return track.title.toLowerCase().includes(searchFilterQuery) ||
           track.artist.toLowerCase().includes(searchFilterQuery) ||
           track.album.toLowerCase().includes(searchFilterQuery);
  });

  if (activeFilterTab === 'albums') {
    // Group by album
    const albums = {};
    filteredTracks.forEach(t => {
      if (!albums[t.album]) albums[t.album] = [];
      albums[t.album].push(t);
    });

    Object.keys(albums).forEach(albumName => {
      const albumTracks = albums[albumName];
      const headerDiv = document.createElement('div');
      headerDiv.style.cssText = 'font-weight:700; color:#5b21b6; margin:8px 0 4px 4px; font-size:0.9rem;';
      headerDiv.innerText = `Álbum: ${albumName} (${albumTracks.length})`;
      container.appendChild(headerDiv);

      albumTracks.forEach(track => createMusicItemElement(track, container));
    });
  } else if (activeFilterTab === 'artists') {
    // Group by artist
    const artists = {};
    filteredTracks.forEach(t => {
      if (!artists[t.artist]) artists[t.artist] = [];
      artists[t.artist].push(t);
    });

    Object.keys(artists).forEach(artistName => {
      const artistTracks = artists[artistName];
      const headerDiv = document.createElement('div');
      headerDiv.style.cssText = 'font-weight:700; color:#5b21b6; margin:8px 0 4px 4px; font-size:0.9rem;';
      headerDiv.innerText = `Cantante: ${artistName} (${artistTracks.length})`;
      container.appendChild(headerDiv);

      artistTracks.forEach(track => createMusicItemElement(track, container));
    });
  } else {
    // Plain list of songs
    filteredTracks.forEach(track => createMusicItemElement(track, container));
  }
}

function createMusicItemElement(track, container) {
  const itemIndex = MUSIC_LIBRARY.findIndex(t => t.id === track.id);
  const isCurrent = itemIndex === currentTrackIndex;

  const itemDiv = document.createElement('div');
  itemDiv.className = `music-item ${isCurrent ? 'active' : ''}`;
  itemDiv.innerHTML = `
    <img src="${track.cover}" class="music-item-img" alt="Cover">
    <div class="music-item-info">
      <div class="music-item-title">${track.title}</div>
      <div class="music-item-sub">${track.artist} • ${track.album}</div>
    </div>
    <span style="font-size:0.75rem; color:#8b5cf6; font-weight:600;">${track.duration}</span>
  `;

  itemDiv.addEventListener('click', () => {
    loadTrack(itemIndex, true);
    const hamburgerMenu = document.getElementById('hamburger-menu');
    if (hamburgerMenu) hamburgerMenu.classList.remove('open');
  });

  container.appendChild(itemDiv);
}

// Thought Bubble & Speech Helpers
let thoughtTimer = null;
let thoughtLoadingTimer = null;

function showThoughtBubbleLoading() {
  stopThoughtLoading();
  const container = document.querySelector('.thought-bubble-container');
  const thoughtText = document.getElementById('thought-text');
  let step = 0;
  const dots = ['.', '. .', '. . .'];
  if (thoughtText) thoughtText.innerText = dots[0];
  if (container) container.style.display = 'block';
  thoughtLoadingTimer = setInterval(() => {
    step = (step + 1) % dots.length;
    if (thoughtText) thoughtText.innerText = dots[step];
  }, 400);
}

function stopThoughtLoading() {
  if (thoughtLoadingTimer) {
    clearInterval(thoughtLoadingTimer);
    thoughtLoadingTimer = null;
  }
}

function showThoughtBubble(text, autoHideMs = 5000) {
  stopThoughtLoading();
  const container = document.querySelector('.thought-bubble-container');
  const thoughtText = document.getElementById('thought-text');
  if (thoughtText) thoughtText.innerText = text;
  if (container) container.style.display = 'block';

  if (thoughtTimer) clearTimeout(thoughtTimer);
  if (autoHideMs > 0) {
    thoughtTimer = setTimeout(() => {
      if (container) container.style.display = 'block';
    }, autoHideMs);
  }
}

async function speakResponse(text) {
  if (!speechEnabled) return;
  stopElevenSpeech();

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
        };

        currentElevenAudio.play().catch(() => {
          if (scene3D) scene3D.setSpeakingState(false);
        });
      }
    }
  } catch (e) {}
}

function stopElevenSpeech() {
  if (currentElevenAudio) {
    currentElevenAudio.pause();
    currentElevenAudio.currentTime = 0;
    currentElevenAudio = null;
  }
  if (scene3D) scene3D.setSpeakingState(false);
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
