// Dedicated Location Management Module
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://qqjhadwxboeichxtxree.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFxamhhZHd4Ym9laWNoeHR4cmVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4NDY4ODAsImV4cCI6MjA5NTQyMjg4MH0.dM1VaV-lDPxoPlOHGAIbgfCSE3RMdURcVubq8tTs6yQ';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const SHARING_ACTIVE_KEY = 'ia_agent_location_sharing_active';
const SHARING_START_KEY = 'ia_agent_location_sharing_start';

let locationUpdateInterval = null;
let watchPositionId = null;
let lastSupabasePushTimestamp = 0;
let lastCoords = null;
let globalUpdateCallback = null;
let isVisibilityListenerAttached = false;

let wakeLock = null;
let bgWorker = null;
let silentAudioCtx = null;
let silentOscillator = null;

// 24 Hours in milliseconds
const MAX_SHARING_DURATION_MS = 24 * 60 * 60 * 1000;
// Minimum interval between pushes when moving (15 seconds)
const MIN_PUSH_INTERVAL_MS = 15 * 1000;
// Maximum interval between pushes even if stationary (2 minutes)
const MAX_PUSH_INTERVAL_MS = 2 * 60 * 1000;

async function requestWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => {
        wakeLock = null;
      });
    } catch (err) {
      console.warn('Wake Lock request failed:', err);
    }
  }
}

function releaseWakeLock() {
  if (wakeLock !== null) {
    try {
      wakeLock.release();
    } catch (e) {}
    wakeLock = null;
  }
}

function startBackgroundWorker(intervalMs = 20000) {
  stopBackgroundWorker();
  try {
    const workerCode = `
      let timer = null;
      self.onmessage = function(e) {
        if (e.data.action === 'start') {
          if (timer) clearInterval(timer);
          timer = setInterval(function() {
            self.postMessage('tick');
          }, e.data.interval || 20000);
        } else if (e.data.action === 'stop') {
          if (timer) clearInterval(timer);
          timer = null;
        }
      };
    `;
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    bgWorker = new Worker(URL.createObjectURL(blob));
    bgWorker.onmessage = async (e) => {
      if (e.data === 'tick' && isSharingLocationActive()) {
        try {
          await updateLocationInSupabase(null, false);
        } catch (err) {}
      }
    };
    bgWorker.postMessage({ action: 'start', interval: intervalMs });
  } catch (e) {
    console.warn('Could not initialize background worker timer:', e);
  }
}

function stopBackgroundWorker() {
  if (bgWorker) {
    try {
      bgWorker.postMessage({ action: 'stop' });
      bgWorker.terminate();
    } catch (e) {}
    bgWorker = null;
  }
}

function startSilentAudioHeartbeat() {
  stopSilentAudioHeartbeat();
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    silentAudioCtx = new AudioCtx();
    const gain = silentAudioCtx.createGain();
    gain.gain.value = 0.0001;
    silentOscillator = silentAudioCtx.createOscillator();
    silentOscillator.type = 'sine';
    silentOscillator.frequency.value = 440;
    silentOscillator.connect(gain);
    gain.connect(silentAudioCtx.destination);
    silentOscillator.start();
  } catch (e) {
    console.warn('Silent audio heartbeat warning:', e);
  }
}

function stopSilentAudioHeartbeat() {
  if (silentOscillator) {
    try { silentOscillator.stop(); } catch (e) {}
    silentOscillator = null;
  }
  if (silentAudioCtx) {
    try { silentAudioCtx.close(); } catch (e) {}
    silentAudioCtx = null;
  }
}

export function getDeviceId() {
  let devId = localStorage.getItem('ia_agent_device_id');
  if (!devId) {
    devId = 'dispositivo_' + Math.random().toString(36).substring(2, 9);
    localStorage.setItem('ia_agent_device_id', devId);
  }
  return devId;
}

export function getTrackingLink() {
  const devId = getDeviceId();
  const baseUrl = window.location.origin + window.location.pathname;
  return `${baseUrl}?track=${devId}`;
}

export function isSharingLocationActive() {
  const isActive = localStorage.getItem(SHARING_ACTIVE_KEY) === 'true';
  if (!isActive) return false;

  const startIso = localStorage.getItem(SHARING_START_KEY);
  if (startIso) {
    const startTime = new Date(startIso).getTime();
    if (Date.now() - startTime > MAX_SHARING_DURATION_MS) {
      stopLocationSharing();
      return false;
    }
  }
  return true;
}

export async function reverseGeocode(lat, lon) {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`, {
      headers: { 'Accept-Language': 'es' }
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.display_name) return data.display_name;
    }
  } catch (e) {}
  return `Latitud ${lat.toFixed(5)}, Longitud ${lon.toFixed(5)}`;
}

export async function getCurrentPositionAsync() {
  if (!('geolocation' in navigator)) {
    throw new Error('La geolocalización no está soportada en este dispositivo.');
  }

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos.coords),
      (err) => {
        console.warn('High accuracy geolocation failed/timed out, attempting low accuracy fallback...', err);
        navigator.geolocation.getCurrentPosition(
          (posLow) => resolve(posLow.coords),
          (errLow) => reject(errLow),
          { enableHighAccuracy: false, timeout: 10000, maximumAge: 15000 }
        );
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });
}

function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export async function updateLocationInSupabase(coordsOverride = null, forcePush = false) {
  try {
    const now = Date.now();
    const timeSinceLastPush = now - lastSupabasePushTimestamp;

    if (!forcePush && lastSupabasePushTimestamp > 0 && timeSinceLastPush < MIN_PUSH_INTERVAL_MS) {
      return null;
    }

    let coords = coordsOverride;
    if (!coords) {
      coords = await getCurrentPositionAsync();
    }

    const lat = coords.latitude;
    const lon = coords.longitude;

    // Check if location moved significantly (> 10 meters) or max interval reached
    let moved = true;
    if (lastCoords) {
      const distKm = calculateDistanceKm(lastCoords.latitude, lastCoords.longitude, lat, lon);
      if (distKm < 0.010 && timeSinceLastPush < MAX_PUSH_INTERVAL_MS && !forcePush) {
        moved = false;
      }
    }

    if (!moved && !forcePush && timeSinceLastPush < MAX_PUSH_INTERVAL_MS) {
      return null;
    }

    const deviceId = getDeviceId();
    const nowIso = new Date().toISOString();
    const initialAddr = `Latitud ${lat.toFixed(5)}, Longitud ${lon.toFixed(5)}`;

    lastSupabasePushTimestamp = now;
    lastCoords = { latitude: lat, longitude: lon };

    // 1. Upsert immediately
    const { error } = await supabase.from('locations').upsert([{
      device_id: deviceId,
      latitude: lat,
      longitude: lon,
      address: initialAddr,
      updated_at: nowIso
    }], { onConflict: 'device_id' });

    if (error) console.warn('Supabase location sync error:', error);

    const payload = { latitude: lat, longitude: lon, address: initialAddr, updated_at: nowIso };

    if (globalUpdateCallback) {
      try { globalUpdateCallback(payload); } catch (e) {}
    }

    // 2. Resolve reverse geocode asynchronously and update address
    reverseGeocode(lat, lon).then(async (resolvedAddr) => {
      if (resolvedAddr && resolvedAddr !== initialAddr) {
        payload.address = resolvedAddr;
        await supabase.from('locations').update({ address: resolvedAddr }).eq('device_id', deviceId);
        if (globalUpdateCallback) {
          try { globalUpdateCallback(payload); } catch (e) {}
        }
      }
    }).catch(() => {});

    return payload;
  } catch (err) {
    console.error('Error al actualizar posición GPS en Supabase:', err);
    throw err;
  }
}

export async function startLocationSharing(onUpdateCallback = null) {
  if (onUpdateCallback) globalUpdateCallback = onUpdateCallback;

  localStorage.setItem(SHARING_ACTIVE_KEY, 'true');
  if (!localStorage.getItem(SHARING_START_KEY)) {
    localStorage.setItem(SHARING_START_KEY, new Date().toISOString());
  }

  // 1. Keep device/screen awake and active using Wake Lock, Web Worker Timer & Web Audio Heartbeat
  requestWakeLock();
  startBackgroundWorker(15000);
  startSilentAudioHeartbeat();

  // Immediate push
  let lastData = null;
  try {
    lastData = await updateLocationInSupabase(null, true);
  } catch (e) {}

  // 2. Register continuous Geolocation Watcher for real-time tracking
  if ('geolocation' in navigator && watchPositionId === null) {
    try {
      watchPositionId = navigator.geolocation.watchPosition(
        async (position) => {
          if (!isSharingLocationActive()) {
            stopLocationSharing();
            return;
          }
          try {
            await updateLocationInSupabase(position.coords);
          } catch (e) {}
        },
        (error) => {
          console.warn('watchPosition warning/error:', error);
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
      );
    } catch (e) {
      console.warn('Could not register watchPosition:', e);
    }
  }

  // 3. Main thread fallback periodic interval (Every 15 seconds)
  if (locationUpdateInterval) clearInterval(locationUpdateInterval);
  locationUpdateInterval = setInterval(async () => {
    if (!isSharingLocationActive()) {
      stopLocationSharing();
      return;
    }
    try {
      await updateLocationInSupabase(null, false);
    } catch (e) {}
  }, 15000);

  // 4. Attach Page Visibility and Window Focus Listeners to catch device wake/app switches
  if (!isVisibilityListenerAttached) {
    isVisibilityListenerAttached = true;

    const pushOnWake = async () => {
      if (isSharingLocationActive()) {
        requestWakeLock();
        try {
          await updateLocationInSupabase(null, true);
        } catch (e) {}
      }
    };

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') pushOnWake();
    });

    window.addEventListener('focus', pushOnWake);
  }

  return lastData;
}

export function initLocationSharingIfActive(onUpdateCallback = null) {
  if (isSharingLocationActive()) {
    console.log('Resuming active real-time location sharing...');
    startLocationSharing(onUpdateCallback).catch((err) => {
      console.warn('Error resuming location sharing:', err);
    });
  }
}

export function stopLocationSharing() {
  localStorage.setItem(SHARING_ACTIVE_KEY, 'false');
  localStorage.removeItem(SHARING_START_KEY);

  releaseWakeLock();
  stopBackgroundWorker();
  stopSilentAudioHeartbeat();

  if (watchPositionId !== null && 'geolocation' in navigator) {
    try {
      navigator.geolocation.clearWatch(watchPositionId);
    } catch (e) {}
    watchPositionId = null;
  }

  if (locationUpdateInterval) {
    clearInterval(locationUpdateInterval);
    locationUpdateInterval = null;
  }

  globalUpdateCallback = null;
  lastSupabasePushTimestamp = 0;
  lastCoords = null;
}

export async function fetchTrackedLocation(targetDeviceId) {
  try {
    const cleanId = (targetDeviceId || '').trim();
    if (!cleanId) {
      return { found: false, error: 'ID de dispositivo no válido.' };
    }

    const { data, error } = await supabase
      .from('locations')
      .select('*')
      .eq('device_id', cleanId)
      .maybeSingle();

    if (error || !data) {
      return { found: false, error: 'No se encontró información de ubicación para este dispositivo.' };
    }

    const updatedAt = new Date(data.updated_at || Date.now());
    const now = new Date();
    const diffMs = now.getTime() - updatedAt.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);

    // Link validity check (24 hours max)
    const isExpired = diffHours > 24;

    const diffMins = Math.floor(diffMs / (1000 * 60));
    let timeAgoStr = 'Hace un momento';
    if (diffMins >= 60) {
      const hrs = Math.floor(diffMins / 60);
      timeAgoStr = `Hace ${hrs} hora${hrs > 1 ? 's' : ''}`;
    } else if (diffMins > 0) {
      timeAgoStr = `Hace ${diffMins} min`;
    }

    return {
      found: true,
      deviceId: data.device_id,
      latitude: data.latitude,
      longitude: data.longitude,
      address: data.address || `Latitud ${data.latitude.toFixed(5)}, Longitud ${data.longitude.toFixed(5)}`,
      updatedAt: data.updated_at,
      timeAgoStr,
      isExpired
    };
  } catch (err) {
    console.error('Error al consultar ubicación rastreada:', err);
    return { found: false, error: 'Error al consultar la ubicación en tiempo real.' };
  }
}

export async function compartirUbicacion() {
  try {
    const data = await startLocationSharing();
    if (!data || typeof data.latitude !== 'number' || typeof data.longitude !== 'number') {
      return 'No se pudo obtener la posición GPS en este momento. Por favor, asegúrate de activar la ubicación/GPS en tu celular y permitir los permisos en el navegador.';
    }
    const link = getTrackingLink();
    const mapsUrl = `https://www.google.com/maps?q=${data.latitude},${data.longitude}`;
    return `Tu ubicación en tiempo real se está compartiendo.\nLink de consulta (válido por 24 horas): ${link}\nGoogle Maps: ${mapsUrl}\nDirección aproximada: ${data.address}`;
  } catch (err) {
    console.error('Error al obtener la ubicación:', err);
    return 'No se pudo obtener tu ubicación actual. Por favor, asegúrate de activar el GPS y permitir los permisos de ubicación en tu navegador.';
  }
}
