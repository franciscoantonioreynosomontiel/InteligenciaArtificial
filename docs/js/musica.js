// Music Player Controller & Cloudinary Voice Interaction
import { Scene3D } from './three-scene.js';

const STORAGE_KEY_MUSIC = 'ia_agent_music_library';

// Default starter tracks uploaded to Cloudinary account dp776nphp
const DEFAULT_MUSIC_LIBRARY = [
  {
    id: 'cld-p77nsjwwltyve2oryjv3',
    title: 'SoundHelix Song 1',
    artist: 'Cloudinary',
    album: 'Cloudinary Hits',
    url: 'https://res.cloudinary.com/dp776nphp/video/upload/v1790847031/p77nsjwwltyve2oryjv3.mp3',
    cover: './assets/img/logopwa.png',
    duration: '06:12'
  }
];

function getStoredMusicLibrary() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_MUSIC);
    if (!raw) {
      localStorage.setItem(STORAGE_KEY_MUSIC, JSON.stringify(DEFAULT_MUSIC_LIBRARY));
      return DEFAULT_MUSIC_LIBRARY;
    }
    const items = JSON.parse(raw);
    if (Array.isArray(items) && items.length > 0) {
      // Filter out non-Cloudinary tracks to enforce strictly Cloudinary dp776nphp assets
      const cldTracks = items.filter(t => t.url && t.url.includes('res.cloudinary.com/dp776nphp/'));
      return cldTracks.length > 0 ? cldTracks : DEFAULT_MUSIC_LIBRARY;
    }
    return DEFAULT_MUSIC_LIBRARY;
  } catch (e) {
    return DEFAULT_MUSIC_LIBRARY;
  }
}

function saveStoredMusicLibrary(library) {
  try {
    localStorage.setItem(STORAGE_KEY_MUSIC, JSON.stringify(library));
  } catch (e) {}
}

let MUSIC_LIBRARY = getStoredMusicLibrary();

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
    showThoughtBubble('Te escucho... Pídeme alguna canción o controla la música.');
  };

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    stopGLTFListening();
    handleMusicVoiceCommand(transcript);
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

async function handleMusicVoiceCommand(userPrompt) {
  showThoughtBubbleLoading();

  try {
    const payload = {
      prompt: userPrompt,
      library: MUSIC_LIBRARY,
      current_index: currentTrackIndex,
      is_playing: isPlaying,
      volume: audioPlayer.volume
    };

    const res = await fetch(`${SUPABASE_URL}/functions/v1/musica`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify(payload)
    });

    stopThoughtBubbleLoading();

    if (res.ok) {
      const data = await res.json();
      const action = data.action;
      const reply = data.reply || 'Procesando tu música.';

      showThoughtBubble(reply, 6000);

      if (action === 'play_track' || action === 'play_album' || action === 'play_artist') {
        if (typeof data.track_index === 'number' && data.track_index >= 0 && data.track_index < MUSIC_LIBRARY.length) {
          loadTrack(data.track_index, true);
        }
      } else if (action === 'next_track') {
        playNextTrack();
      } else if (action === 'prev_track') {
        playPrevTrack();
      } else if (action === 'control_playback') {
        togglePlayPause();
      } else if (action === 'control_volume') {
        if (typeof data.volume === 'number') {
          audioPlayer.volume = data.volume;
          const volumeSlider = document.getElementById('volume-slider');
          if (volumeSlider) volumeSlider.value = data.volume;
        }
      }

      if (speechEnabled && reply) {
        speakResponse(reply);
      }
    } else {
      showThoughtBubble('No pude comunicarme con el servicio de música.', 4000);
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
  if (MUSIC_LIBRARY.length === 0) return;
  if (index < 0 || index >= MUSIC_LIBRARY.length) index = 0;
  currentTrackIndex = index;
  const track = MUSIC_LIBRARY[currentTrackIndex];

  audioPlayer.src = track.url;

  const titleElem = document.getElementById('track-title');
  const artistElem = document.getElementById('track-artist');
  const coverElem = document.getElementById('track-cover');

  if (titleElem) titleElem.innerText = track.title;
  if (artistElem) artistElem.innerText = `${track.artist} • ${track.album}`;
  if (coverElem) coverElem.src = track.cover || './assets/img/logopwa.png';

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
  if (MUSIC_LIBRARY.length === 0) return;
  if (isShuffle) {
    let nextIndex = Math.floor(Math.random() * MUSIC_LIBRARY.length);
    if (nextIndex === currentTrackIndex && MUSIC_LIBRARY.length > 1) {
      nextIndex = (currentTrackIndex + 1) % MUSIC_LIBRARY.length;
    }
    loadTrack(nextIndex, true);
  } else {
    const nextIndex = (currentTrackIndex + 1) % MUSIC_LIBRARY.length;
    loadTrack(nextIndex, true);
  }
}

function playPrevTrack() {
  if (MUSIC_LIBRARY.length === 0) return;
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

  if (filteredTracks.length === 0) {
    container.innerHTML = `<div style="text-align:center; padding: 20px; color: #64748b; font-size: 0.85rem;">No hay canciones encontradas en tu biblioteca de Cloudinary.</div>`;
    return;
  }

  if (activeFilterTab === 'albums') {
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
    filteredTracks.forEach(track => createMusicItemElement(track, container));
  }
}

function createMusicItemElement(track, container) {
  const itemIndex = MUSIC_LIBRARY.findIndex(t => t.id === track.id || t.url === track.url);
  const isCurrent = itemIndex === currentTrackIndex;

  const itemDiv = document.createElement('div');
  itemDiv.className = `music-item ${isCurrent ? 'active' : ''}`;
  itemDiv.innerHTML = `
    <img src="${track.cover || './assets/img/logopwa.png'}" class="music-item-img" alt="Cover">
    <div class="music-item-info">
      <div class="music-item-title">${track.title}</div>
      <div class="music-item-sub">${track.artist} • ${track.album}</div>
    </div>
    <span style="font-size:0.75rem; color:#8b5cf6; font-weight:600;">${track.duration || '06:12'}</span>
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
  const container = document.querySelector('.music-thought-container');
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
  const container = document.querySelector('.music-thought-container');
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
