// Music Player Controller & Cloudinary Voice Interaction
import { Scene3D } from './three-scene.js';

const STORAGE_KEY_MUSIC = 'ia_agent_music_library';

// Default starter tracks uploaded to Cloudinary account dp776nphp
const DEFAULT_MUSIC_LIBRARY = [
  {
    id: 'cld-p77nsjwwltyve2oryjv3',
    title: 'Canción Cloudinary 1',
    artist: 'Cloudinary',
    album: 'Mi Música Cloudinary',
    url: 'https://res.cloudinary.com/dp776nphp/video/upload/v1790847031/p77nsjwwltyve2oryjv3.mp3',
    cover: './assets/img/logopwa.png',
    duration: '06:12'
  }
];

function deduplicateTracks(tracks) {
  if (!Array.isArray(tracks)) return [];
  const seen = new Set();
  return tracks.filter(t => {
    const key = t.url || t.id;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getStoredMusicLibrary() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_MUSIC);
    if (!raw) {
      localStorage.setItem(STORAGE_KEY_MUSIC, JSON.stringify(DEFAULT_MUSIC_LIBRARY));
      return DEFAULT_MUSIC_LIBRARY;
    }
    const items = JSON.parse(raw);
    if (Array.isArray(items) && items.length > 0) {
      // Enforce strictly Cloudinary dp776nphp assets
      const cldTracks = items
        .filter(t => t.url && t.url.includes('res.cloudinary.com/dp776nphp/'))
        .map(t => {
          if (t.title.includes('SoundHelix')) t.title = 'Canción Cloudinary 1';
          return t;
        });
      const unique = deduplicateTracks(cldTracks);
      return unique.length > 0 ? unique : DEFAULT_MUSIC_LIBRARY;
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
let currentQueue = [...MUSIC_LIBRARY];

// Audio State
let audioPlayer = new Audio();
let currentTrackIndex = 0;
let isPlaying = false;
let isShuffle = false;
let isRepeat = false;
let activeFilterTab = 'songs'; // 'songs', 'albums', 'artists'
let searchFilterQuery = '';

// View & Queue State
let currentViewedAlbum = '';
let expandedArtists = {};

// Edit & Delete Track Modal State
let editingTrackIndex = -1;
let deletingTrackIndex = -1;

function playAlbumQueue(albumName) {
  const albumTracks = MUSIC_LIBRARY.filter(t => t.album === albumName);
  if (albumTracks.length > 0) {
    currentQueue = [...albumTracks];
    loadTrack(0, true);
    showToast(`Reproduciendo álbum: ${albumName}`);
    const hamburgerMenu = document.getElementById('hamburger-menu');
    if (hamburgerMenu) hamburgerMenu.classList.remove('open');
    const modalViewAlbum = document.getElementById('modal-view-album');
    if (modalViewAlbum) modalViewAlbum.classList.remove('open');
  } else {
    showToast('El álbum no contiene canciones.');
  }
}

function playArtistQueue(artistName) {
  const artistTracks = MUSIC_LIBRARY.filter(t => t.artist === artistName);
  if (artistTracks.length > 0) {
    currentQueue = [...artistTracks];
    loadTrack(0, true);
    showToast(`Reproduciendo cantante: ${artistName}`);
    const hamburgerMenu = document.getElementById('hamburger-menu');
    if (hamburgerMenu) hamburgerMenu.classList.remove('open');
  } else {
    showToast('El cantante no contiene canciones.');
  }
}

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
  setupModalEventListeners();
  loadTrack(currentTrackIndex, false);
  renderLibraryList();
  fetchCloudinaryTracksFromEdge();
});

async function fetchCloudinaryTracksFromEdge() {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/musica`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({ action: 'list_cloudinary' })
    });

    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.tracks) && data.tracks.length > 0) {
        let updatedCount = 0;
        data.tracks.forEach(remoteTrack => {
          const existingIdx = MUSIC_LIBRARY.findIndex(t => t.url === remoteTrack.url || t.id === remoteTrack.id);
          if (existingIdx === -1) {
            MUSIC_LIBRARY.push(remoteTrack);
            updatedCount++;
          } else {
            const currTitle = MUSIC_LIBRARY[existingIdx].title;
            const isHashOrGeneric = currTitle.startsWith('Canción Cloudinary') || /^[a-zA-Z0-9]{8,32}$/.test(currTitle);
            if (isHashOrGeneric || (remoteTrack.title && !remoteTrack.title.startsWith('Canción Cloudinary') && !/^[a-zA-Z0-9]{8,32}$/.test(remoteTrack.title))) {
              if (MUSIC_LIBRARY[existingIdx].title !== remoteTrack.title || MUSIC_LIBRARY[existingIdx].artist !== remoteTrack.artist) {
                MUSIC_LIBRARY[existingIdx].title = remoteTrack.title;
                MUSIC_LIBRARY[existingIdx].artist = remoteTrack.artist;
                updatedCount++;
              }
            }
          }
        });
        MUSIC_LIBRARY = deduplicateTracks(MUSIC_LIBRARY);
        if (updatedCount > 0 || MUSIC_LIBRARY.length > 0) {
          saveStoredMusicLibrary(MUSIC_LIBRARY);
          renderLibraryList();
          if (MUSIC_LIBRARY[currentTrackIndex]) {
            const titleElem = document.getElementById('track-title');
            const artistElem = document.getElementById('track-artist');
            if (titleElem) titleElem.innerText = MUSIC_LIBRARY[currentTrackIndex].title;
            if (artistElem) artistElem.innerText = `${MUSIC_LIBRARY[currentTrackIndex].artist} • ${MUSIC_LIBRARY[currentTrackIndex].album}`;
          }
        }
      }
    }
  } catch (e) {
    console.warn('No se pudieron obtener temas remotos de Cloudinary:', e);
  }
}

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
        if (data.album_name) {
          playAlbumQueue(data.album_name);
        } else if (data.artist_name) {
          playArtistQueue(data.artist_name);
        } else if (typeof data.track_index === 'number' && data.track_index >= 0 && data.track_index < MUSIC_LIBRARY.length) {
          currentQueue = [...MUSIC_LIBRARY];
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
  if (!currentQueue || currentQueue.length === 0) {
    currentQueue = [...MUSIC_LIBRARY];
  }
  if (currentQueue.length === 0) return;
  if (index < 0 || index >= currentQueue.length) index = 0;
  currentTrackIndex = index;
  const track = currentQueue[currentTrackIndex];

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
  if (!currentQueue || currentQueue.length === 0) currentQueue = [...MUSIC_LIBRARY];
  if (currentQueue.length === 0) return;
  if (isShuffle) {
    let nextIndex = Math.floor(Math.random() * currentQueue.length);
    if (nextIndex === currentTrackIndex && currentQueue.length > 1) {
      nextIndex = (currentTrackIndex + 1) % currentQueue.length;
    }
    loadTrack(nextIndex, true);
  } else {
    const nextIndex = (currentTrackIndex + 1) % currentQueue.length;
    loadTrack(nextIndex, true);
  }
}

function playPrevTrack() {
  if (!currentQueue || currentQueue.length === 0) currentQueue = [...MUSIC_LIBRARY];
  if (currentQueue.length === 0) return;
  const prevIndex = (currentTrackIndex - 1 + currentQueue.length) % currentQueue.length;
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

  // Cloudinary Upload Button & Input Handler
  const btnUploadMusic = document.getElementById('btn-upload-music');
  const musicUploadInput = document.getElementById('music-upload-input');
  const uploadStatus = document.getElementById('upload-status');

  if (btnUploadMusic && musicUploadInput) {
    btnUploadMusic.addEventListener('click', () => musicUploadInput.click());
    musicUploadInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      if (uploadStatus) {
        uploadStatus.innerText = 'Subiendo a Cloudinary...';
        uploadStatus.style.display = 'block';
      }

      const formData = new FormData();
      formData.append('file', file);
      formData.append('upload_preset', 'vit0x7dr');

      try {
        const response = await fetch('https://api.cloudinary.com/v1_1/dp776nphp/video/upload', {
          method: 'POST',
          body: formData
        });

        const data = await response.json();

        if (data.secure_url) {
          if (uploadStatus) uploadStatus.innerText = '¡Subida exitosa!';
          const fileName = file.name.replace(/\.[^/.]+$/, '');
          const newTrack = {
            id: data.public_id || ('cld-' + Date.now()),
            title: fileName,
            artist: 'Cloudinary',
            album: 'Mi Música',
            url: data.secure_url,
            cover: './assets/img/logopwa.png',
            duration: formatTime(data.duration || 0)
          };

          MUSIC_LIBRARY.push(newTrack);
          saveStoredMusicLibrary(MUSIC_LIBRARY);
          renderLibraryList();

          // Open edit modal for freshly uploaded track so user can set title & artist
          openEditTrackModal(MUSIC_LIBRARY.length - 1);

          setTimeout(() => {
            if (uploadStatus) uploadStatus.style.display = 'none';
          }, 3000);
        } else {
          if (uploadStatus) uploadStatus.innerText = 'Error al subir: ' + (data.error ? data.error.message : 'Error desconocido');
        }
      } catch (err) {
        if (uploadStatus) uploadStatus.innerText = 'Error de red: ' + err.message;
      } finally {
        musicUploadInput.value = '';
      }
    });
  }
}

// Modals Handling (Edit, Delete, Create Album, View Album)
function setupModalEventListeners() {
  // Close modals when clicking close button
  document.querySelectorAll('.btn-close-modal').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const modal = e.target.closest('.music-modal-overlay');
      if (modal) modal.classList.remove('open');
    });
  });

  // Edit Track Modal Controls
  const btnCancelEdit = document.getElementById('btn-cancel-edit-track');
  const btnSaveEdit = document.getElementById('btn-save-edit-track');

  if (btnCancelEdit) {
    btnCancelEdit.addEventListener('click', () => {
      document.getElementById('modal-edit-track')?.classList.remove('open');
    });
  }

  if (btnSaveEdit) {
    btnSaveEdit.addEventListener('click', () => {
      if (editingTrackIndex >= 0 && editingTrackIndex < MUSIC_LIBRARY.length) {
        const titleInput = document.getElementById('edit-track-title');
        const artistInput = document.getElementById('edit-track-artist');
        const albumInput = document.getElementById('edit-track-album');

        const newTitle = titleInput ? titleInput.value.trim() : '';
        const newArtist = artistInput ? artistInput.value.trim() : '';
        const newAlbum = albumInput ? albumInput.value.trim() : '';

        if (!newTitle) {
          showToast('El nombre de la canción no puede estar vacío.');
          return;
        }

        MUSIC_LIBRARY[editingTrackIndex].title = newTitle;
        MUSIC_LIBRARY[editingTrackIndex].artist = newArtist || 'Cloudinary';
        MUSIC_LIBRARY[editingTrackIndex].album = newAlbum || 'Mi Música';

        saveStoredMusicLibrary(MUSIC_LIBRARY);
        renderLibraryList();

        if (editingTrackIndex === currentTrackIndex) {
          loadTrack(currentTrackIndex, isPlaying);
        }

        showToast('Canción actualizada con éxito.');
        document.getElementById('modal-edit-track')?.classList.remove('open');
      }
    });
  }

  // Delete Track Modal Controls
  const btnCancelDelete = document.getElementById('btn-cancel-delete-track');
  const btnConfirmDelete = document.getElementById('btn-confirm-delete-track');

  if (btnCancelDelete) {
    btnCancelDelete.addEventListener('click', () => {
      document.getElementById('modal-delete-track')?.classList.remove('open');
    });
  }

  if (btnConfirmDelete) {
    btnConfirmDelete.addEventListener('click', () => {
      if (deletingTrackIndex >= 0 && deletingTrackIndex < MUSIC_LIBRARY.length) {
        const deletedTitle = MUSIC_LIBRARY[deletingTrackIndex].title;
        MUSIC_LIBRARY.splice(deletingTrackIndex, 1);
        saveStoredMusicLibrary(MUSIC_LIBRARY);

        if (MUSIC_LIBRARY.length === 0) {
          currentTrackIndex = 0;
          audioPlayer.pause();
          setIsPlaying(false);
          const titleElem = document.getElementById('track-title');
          const artistElem = document.getElementById('track-artist');
          if (titleElem) titleElem.innerText = 'Selecciona una canción';
          if (artistElem) artistElem.innerText = 'Biblioteca Amigo';
        } else {
          if (currentTrackIndex >= MUSIC_LIBRARY.length) {
            currentTrackIndex = MUSIC_LIBRARY.length - 1;
          }
          loadTrack(currentTrackIndex, isPlaying);
        }

        renderLibraryList();
        showToast(`Canción "${deletedTitle}" eliminada.`);
        document.getElementById('modal-delete-track')?.classList.remove('open');
      }
    });
  }

  // Create Album Modal Controls
  const btnCancelAlbum = document.getElementById('btn-cancel-create-album');
  const btnSaveAlbum = document.getElementById('btn-save-create-album');

  if (btnCancelAlbum) {
    btnCancelAlbum.addEventListener('click', () => {
      document.getElementById('modal-create-album')?.classList.remove('open');
    });
  }

  if (btnSaveAlbum) {
    btnSaveAlbum.addEventListener('click', () => {
      const albumInput = document.getElementById('new-album-name');
      const albumName = albumInput ? albumInput.value.trim() : '';

      if (!albumName) {
        showToast('Escribe un nombre para el álbum.');
        return;
      }

      const selectedCheckboxes = document.querySelectorAll('#create-album-songs-list input[type="checkbox"]:checked');
      if (selectedCheckboxes.length === 0) {
        showToast('Selecciona al menos una canción para el álbum.');
        return;
      }

      selectedCheckboxes.forEach(cb => {
        const idx = parseInt(cb.value, 10);
        if (idx >= 0 && idx < MUSIC_LIBRARY.length) {
          MUSIC_LIBRARY[idx].album = albumName;
        }
      });

      saveStoredMusicLibrary(MUSIC_LIBRARY);
      renderLibraryList();
      showToast(`Álbum "${albumName}" creado.`);
      document.getElementById('modal-create-album')?.classList.remove('open');
    });
  }

  // View Album Modal Controls
  const btnCloseAlbumView = document.getElementById('btn-close-album-view');
  if (btnCloseAlbumView) {
    btnCloseAlbumView.addEventListener('click', () => {
      document.getElementById('modal-view-album')?.classList.remove('open');
    });
  }

  const btnPlayAlbumView = document.getElementById('btn-play-album-view');
  if (btnPlayAlbumView) {
    btnPlayAlbumView.addEventListener('click', () => {
      if (currentViewedAlbum) {
        playAlbumQueue(currentViewedAlbum);
      }
    });
  }
}

function openEditTrackModal(index) {
  if (index < 0 || index >= MUSIC_LIBRARY.length) return;
  editingTrackIndex = index;
  const track = MUSIC_LIBRARY[index];

  const titleInput = document.getElementById('edit-track-title');
  const artistInput = document.getElementById('edit-track-artist');
  const albumInput = document.getElementById('edit-track-album');

  if (titleInput) titleInput.value = track.title || '';
  if (artistInput) artistInput.value = track.artist || '';
  if (albumInput) albumInput.value = track.album || '';

  const modal = document.getElementById('modal-edit-track');
  if (modal) modal.classList.add('open');
}

function openDeleteTrackModal(index) {
  if (index < 0 || index >= MUSIC_LIBRARY.length) return;
  deletingTrackIndex = index;
  const track = MUSIC_LIBRARY[index];

  const textElem = document.getElementById('delete-track-confirm-text');
  if (textElem) {
    textElem.style.color = 'var(--music-text-primary)';
    textElem.innerText = `¿Estás seguro de que deseas eliminar "${track.title}"?`;
  }

  const modal = document.getElementById('modal-delete-track');
  if (modal) modal.classList.add('open');
}

function openCreateAlbumModal() {
  const albumInput = document.getElementById('new-album-name');
  if (albumInput) albumInput.value = '';

  MUSIC_LIBRARY = deduplicateTracks(MUSIC_LIBRARY);
  saveStoredMusicLibrary(MUSIC_LIBRARY);

  const listContainer = document.getElementById('create-album-songs-list');
  if (listContainer) {
    listContainer.innerHTML = '';
    if (MUSIC_LIBRARY.length === 0) {
      listContainer.innerHTML = '<div style="font-size:0.85rem; color:#64748b;">No hay canciones disponibles.</div>';
    } else {
      const seenUrls = new Set();
      MUSIC_LIBRARY.forEach((track, idx) => {
        const key = track.url || track.id || idx;
        if (seenUrls.has(key)) return;
        seenUrls.add(key);

        const itemLabel = document.createElement('label');
        itemLabel.className = 'song-select-item';
        itemLabel.innerHTML = `
          <input type="checkbox" value="${idx}">
          <span>${track.title} (${track.artist})</span>
        `;
        listContainer.appendChild(itemLabel);
      });
    }
  }

  const modal = document.getElementById('modal-create-album');
  if (modal) modal.classList.add('open');
}

function openViewAlbumModal(albumName) {
  currentViewedAlbum = albumName;
  const titleElem = document.getElementById('album-view-title');
  if (titleElem) titleElem.innerText = `Álbum: ${albumName}`;

  const listContainer = document.getElementById('album-view-songs-list');
  if (listContainer) {
    listContainer.innerHTML = '';
    const albumTracks = MUSIC_LIBRARY.filter(t => t.album === albumName);

    if (albumTracks.length === 0) {
      listContainer.innerHTML = '<div style="text-align:center; padding:16px; color:#64748b; font-size:0.85rem;">No hay canciones en este álbum.</div>';
    } else {
      albumTracks.forEach(track => {
        const queueIdx = albumTracks.findIndex(t => t.id === track.id || t.url === track.url);
        createMusicItemElement(track, listContainer, queueIdx, albumTracks);
      });
    }
  }

  const modal = document.getElementById('modal-view-album');
  if (modal) modal.classList.add('open');
}

function moveTrackUp(index) {
  if (index <= 0 || index >= MUSIC_LIBRARY.length) return;
  const temp = MUSIC_LIBRARY[index];
  MUSIC_LIBRARY[index] = MUSIC_LIBRARY[index - 1];
  MUSIC_LIBRARY[index - 1] = temp;

  if (currentTrackIndex === index) {
    currentTrackIndex = index - 1;
  } else if (currentTrackIndex === index - 1) {
    currentTrackIndex = index;
  }

  saveStoredMusicLibrary(MUSIC_LIBRARY);
  renderLibraryList();
}

function moveTrackDown(index) {
  if (index < 0 || index >= MUSIC_LIBRARY.length - 1) return;
  const temp = MUSIC_LIBRARY[index];
  MUSIC_LIBRARY[index] = MUSIC_LIBRARY[index + 1];
  MUSIC_LIBRARY[index + 1] = temp;

  if (currentTrackIndex === index) {
    currentTrackIndex = index + 1;
  } else if (currentTrackIndex === index + 1) {
    currentTrackIndex = index;
  }

  saveStoredMusicLibrary(MUSIC_LIBRARY);
  renderLibraryList();
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
    // Render Album Grid with "+" button header
    const headerRow = document.createElement('div');
    headerRow.className = 'albums-section-header';
    headerRow.innerHTML = `
      <span style="font-weight:700; color:var(--music-text-accent); font-size:0.95rem;">Tus Álbumes</span>
      <button id="btn-add-album-header" class="btn-add-album">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
        <span>Crear Álbum</span>
      </button>
    `;
    container.appendChild(headerRow);

    const btnAddAlbum = headerRow.querySelector('#btn-add-album-header');
    if (btnAddAlbum) btnAddAlbum.addEventListener('click', openCreateAlbumModal);

    const albums = {};
    filteredTracks.forEach(t => {
      const albumKey = t.album || 'Sin Álbum';
      if (!albums[albumKey]) albums[albumKey] = [];
      albums[albumKey].push(t);
    });

    const albumKeys = Object.keys(albums);

    if (albumKeys.length === 0) {
      container.innerHTML += `<div style="text-align:center; padding: 20px; color: var(--music-text-secondary); font-size: 0.85rem;">No se encontraron álbumes.</div>`;
      return;
    }

    const gridDiv = document.createElement('div');
    gridDiv.className = 'albums-grid';

    albumKeys.forEach(albumName => {
      const albumTracks = albums[albumName];
      const coverArt = albumTracks[0]?.cover || './assets/img/logopwa.png';

      const card = document.createElement('div');
      card.className = 'album-card';
      card.innerHTML = `
        <img src="${coverArt}" class="album-card-img" alt="${albumName}">
        <div class="album-card-title">${albumName}</div>
        <div class="album-card-count">${albumTracks.length} canción${albumTracks.length === 1 ? '' : 'es'}</div>
      `;

      card.addEventListener('click', () => {
        openViewAlbumModal(albumName);
      });

      gridDiv.appendChild(card);
    });

    container.appendChild(gridDiv);

  } else if (activeFilterTab === 'artists') {
    const artists = {};
    filteredTracks.forEach(t => {
      const artistKey = t.artist || 'Artista Desconocido';
      if (!artists[artistKey]) artists[artistKey] = [];
      artists[artistKey].push(t);
    });

    const artistKeys = Object.keys(artists);

    if (artistKeys.length === 0) {
      container.innerHTML = `<div style="text-align:center; padding: 20px; color: var(--music-text-secondary); font-size: 0.85rem;">No hay cantantes encontrados.</div>`;
      return;
    }

    artistKeys.forEach(artistName => {
      const artistTracks = artists[artistName];
      const isExpanded = !!expandedArtists[artistName];

      const artistCard = document.createElement('div');
      artistCard.style.cssText = 'background:var(--music-card-bg); border:1px solid var(--music-card-border); border-radius:14px; margin-bottom:10px; overflow:hidden;';

      const cardHeader = document.createElement('div');
      cardHeader.style.cssText = 'display:flex; align-items:center; justify-content:space-between; padding:12px; cursor:pointer; background:var(--music-card-bg);';
      cardHeader.innerHTML = `
        <div style="display:flex; align-items:center; gap:10px; flex:1;">
          <div style="width:36px; height:36px; border-radius:50%; background:var(--music-input-bg); color:var(--music-text-accent); display:flex; align-items:center; justify-content:center; font-weight:700; font-size:0.9rem;">
            ${artistName.charAt(0).toUpperCase()}
          </div>
          <div>
            <div style="font-size:0.95rem; font-weight:700; color:var(--music-text-primary);">${artistName}</div>
            <div style="font-size:0.75rem; color:var(--music-text-secondary);">${artistTracks.length} canción${artistTracks.length === 1 ? '' : 'es'}</div>
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:6px;">
          <button class="btn-play-artist" title="Reproducir cantante" style="padding:6px 12px; border-radius:16px; background:#8b5cf6; color:#ffffff; border:none; font-size:0.8rem; font-weight:600; cursor:pointer;">
            Reproducir
          </button>
          <span style="font-size:1.1rem; color:var(--music-text-accent); padding:4px;">${isExpanded ? '▲' : '▼'}</span>
        </div>
      `;

      const tracksDiv = document.createElement('div');
      tracksDiv.style.cssText = `display:${isExpanded ? 'flex' : 'none'}; flex-direction:column; gap:6px; padding:10px; background:var(--music-controls-bg); border-top:1px solid var(--music-controls-border);`;

      if (isExpanded) {
        artistTracks.forEach((track, idx) => {
          createMusicItemElement(track, tracksDiv, idx, artistTracks);
        });
      }

      cardHeader.addEventListener('click', (e) => {
        if (e.target.closest('.btn-play-artist')) return;
        expandedArtists[artistName] = !expandedArtists[artistName];
        renderLibraryList();
      });

      cardHeader.querySelector('.btn-play-artist').addEventListener('click', (e) => {
        e.stopPropagation();
        playArtistQueue(artistName);
      });

      artistCard.appendChild(cardHeader);
      artistCard.appendChild(tracksDiv);
      container.appendChild(artistCard);
    });

  } else {
    // Default 'songs' view
    if (filteredTracks.length === 0) {
      container.innerHTML = `<div style="text-align:center; padding: 20px; color: var(--music-text-secondary); font-size: 0.85rem;">No hay canciones encontradas en tu biblioteca de Cloudinary.</div>`;
      return;
    }

    filteredTracks.forEach(track => createMusicItemElement(track, container));
  }
}

function createMusicItemElement(track, container, customIndex = null, sourceQueue = null) {
  const targetQueue = sourceQueue || MUSIC_LIBRARY;
  const itemIndex = customIndex !== null ? customIndex : targetQueue.findIndex(t => t.id === track.id || t.url === track.url);

  const currentTrack = currentQueue[currentTrackIndex];
  const isCurrent = currentTrack && (currentTrack.id === track.id || currentTrack.url === track.url);

  const itemDiv = document.createElement('div');
  itemDiv.className = `music-item ${isCurrent ? 'active' : ''}`;
  itemDiv.innerHTML = `
    <img src="${track.cover || './assets/img/logopwa.png'}" class="music-item-img" alt="Cover">
    <div class="music-item-info">
      <div class="music-item-title">${track.title}</div>
      <div class="music-item-sub">${track.artist} • ${track.album}</div>
    </div>
    <div class="item-actions">
      <button class="btn-item-action move-up" title="Mover arriba" aria-label="Mover arriba">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>
      </button>
      <button class="btn-item-action move-down" title="Mover abajo" aria-label="Mover abajo">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
      </button>
      <button class="btn-item-action edit" title="Editar canción" aria-label="Editar canción">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
      </button>
      <button class="btn-item-action delete" title="Eliminar canción" aria-label="Eliminar canción">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
      </button>
    </div>
  `;

  const globalIndex = MUSIC_LIBRARY.findIndex(t => t.id === track.id || t.url === track.url);

  const playThisTrack = () => {
    currentQueue = [...targetQueue];
    loadTrack(itemIndex, true);
    const hamburgerMenu = document.getElementById('hamburger-menu');
    if (hamburgerMenu) hamburgerMenu.classList.remove('open');
    const modalViewAlbum = document.getElementById('modal-view-album');
    if (modalViewAlbum) modalViewAlbum.classList.remove('open');
  };

  itemDiv.querySelector('.music-item-info').addEventListener('click', playThisTrack);
  itemDiv.querySelector('.music-item-img').addEventListener('click', playThisTrack);

  itemDiv.querySelector('.move-up').addEventListener('click', (e) => {
    e.stopPropagation();
    moveTrackUp(globalIndex);
  });

  itemDiv.querySelector('.move-down').addEventListener('click', (e) => {
    e.stopPropagation();
    moveTrackDown(globalIndex);
  });

  itemDiv.querySelector('.edit').addEventListener('click', (e) => {
    e.stopPropagation();
    openEditTrackModal(globalIndex);
  });

  itemDiv.querySelector('.delete').addEventListener('click', (e) => {
    e.stopPropagation();
    openDeleteTrackModal(globalIndex);
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
  if (!container && !thoughtText) return;
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
  if (!container && !thoughtText) return;
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
