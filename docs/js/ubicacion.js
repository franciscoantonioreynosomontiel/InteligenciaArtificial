// Dedicated Location Management Module
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://qqjhadwxboeichxtxree.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFxamhhZHd4Ym9laWNoeHR4cmVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4NDY4ODAsImV4cCI6MjA5NTQyMjg4MH0.dM1VaV-lDPxoPlOHGAIbgfCSE3RMdURcVubq8tTs6yQ';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const SHARING_ACTIVE_KEY = 'ia_agent_location_sharing_active';
const SHARING_START_KEY = 'ia_agent_location_sharing_start';
let locationUpdateInterval = null;

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
  return localStorage.getItem(SHARING_ACTIVE_KEY) === 'true';
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
          { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
        );
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );
  });
}

export async function updateLocationInSupabase() {
  try {
    const coords = await getCurrentPositionAsync();
    const lat = coords.latitude;
    const lon = coords.longitude;
    const deviceId = getDeviceId();
    const nowIso = new Date().toISOString();
    const initialAddr = `Latitud ${lat.toFixed(5)}, Longitud ${lon.toFixed(5)}`;

    // 1. Upsert immediately so record exists without waiting for geocoder
    const { error } = await supabase.from('locations').upsert([{
      device_id: deviceId,
      latitude: lat,
      longitude: lon,
      address: initialAddr,
      updated_at: nowIso
    }], { onConflict: 'device_id' });

    if (error) console.warn('Supabase location initial sync error:', error);

    // 2. Resolve reverse geocode asynchronously and update address
    reverseGeocode(lat, lon).then(async (resolvedAddr) => {
      if (resolvedAddr && resolvedAddr !== initialAddr) {
        await supabase.from('locations').update({ address: resolvedAddr }).eq('device_id', deviceId);
      }
    }).catch(() => {});

    return { latitude: lat, longitude: lon, address: initialAddr, updated_at: nowIso };
  } catch (err) {
    console.error('Error al actualizar posición GPS:', err);
    throw err;
  }
}

export async function startLocationSharing(onUpdateCallback = null) {
  localStorage.setItem(SHARING_ACTIVE_KEY, 'true');
  if (!localStorage.getItem(SHARING_START_KEY)) {
    localStorage.setItem(SHARING_START_KEY, new Date().toISOString());
  }

  // Immediate push
  let lastData = null;
  try {
    lastData = await updateLocationInSupabase();
    if (onUpdateCallback) onUpdateCallback(lastData);
  } catch (e) {}

  // Low data periodic background update (Every 30 seconds = minimal network data usage)
  if (locationUpdateInterval) clearInterval(locationUpdateInterval);
  locationUpdateInterval = setInterval(async () => {
    if (!isSharingLocationActive()) {
      stopLocationSharing();
      return;
    }
    try {
      const data = await updateLocationInSupabase();
      if (onUpdateCallback) onUpdateCallback(data);
    } catch (e) {}
  }, 30000);

  return lastData;
}

export function stopLocationSharing() {
  localStorage.setItem(SHARING_ACTIVE_KEY, 'false');
  localStorage.removeItem(SHARING_START_KEY);
  if (locationUpdateInterval) {
    clearInterval(locationUpdateInterval);
    locationUpdateInterval = null;
  }
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
