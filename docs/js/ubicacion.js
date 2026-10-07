// Dedicated Location Management Module
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://qqjhadwxboeichxtxree.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFxamhhZHd4Ym9laWNoeHR4cmVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4NDY4ODAsImV4cCI6MjA5NTQyMjg4MH0.dM1VaV-lDPxoPlOHGAIbgfCSE3RMdURcVubq8tTs6yQ';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function getDeviceId() {
  let devId = localStorage.getItem('ia_agent_device_id');
  if (!devId) {
    devId = 'dispositivo_' + Math.random().toString(36).substring(2, 9);
    localStorage.setItem('ia_agent_device_id', devId);
  }
  return devId;
}

async function reverseGeocode(lat, lon) {
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
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      return reject(new Error('La geolocalización no está soportada en este dispositivo.'));
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos.coords),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
}

export async function compartirUbicacion() {
  try {
    const coords = await getCurrentPositionAsync();
    const lat = coords.latitude;
    const lon = coords.longitude;
    const deviceId = getDeviceId();
    const address = await reverseGeocode(lat, lon);

    try {
      await supabase.from('locations').upsert([{
        device_id: deviceId,
        latitude: lat,
        longitude: lon,
        address: address,
        updated_at: new Date().toISOString()
      }], { onConflict: 'device_id' });
    } catch (e) {
      console.warn('Error syncing location to Supabase:', e);
    }

    const mapsUrl = `https://www.google.com/maps?q=${lat},${lon}`;
    return `Aquí tienes tu ubicación actual en tiempo real: ${mapsUrl}\nDirección aproximada: ${address}`;
  } catch (err) {
    console.error('Error al obtener la ubicación:', err);
    return 'No se pudo obtener tu ubicación actual. Por favor, asegúrate de activar el GPS y permitir los permisos de ubicación en tu navegador.';
  }
}
