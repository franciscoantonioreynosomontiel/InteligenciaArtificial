// Perfil Médico del Paciente - docs/js/perfilmedico.js
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://qqjhadwxboeichxtxree.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFxamhhZHd4Ym9laWNoeHR4cmVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4NDY4ODAsImV4cCI6MjA5NTQyMjg4MH0.dM1VaV-lDPxoPlOHGAIbgfCSE3RMdURcVubq8tTs6yQ';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const PROFILE_KEY = 'ia_agent_patient_profile';

document.addEventListener('DOMContentLoaded', () => {
  setupFormListener();
  loadPatientProfile();
});

function getStoredProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveStoredProfile(profile) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch (e) {}
}

async function loadPatientProfile() {
  let profile = getStoredProfile();

  // Try fetching from Supabase
  try {
    const { data, error } = await supabase
      .from('patient_profiles')
      .select('*')
      .eq('user_id', 'default_patient')
      .limit(1);

    if (!error && Array.isArray(data) && data.length > 0) {
      const dbProf = data[0];
      profile = {
        id: dbProf.id,
        user_id: dbProf.user_id,
        age: dbProf.age,
        gender: dbProf.gender,
        height: dbProf.height,
        weight: dbProf.weight,
        blood_type: dbProf.blood_type,
        allergies: dbProf.allergies,
        hereditary_diseases: dbProf.hereditary_diseases,
        chronic_conditions: dbProf.chronic_conditions,
        medications: dbProf.medications,
        notes: dbProf.notes,
        updatedAt: dbProf.updated_at
      };
      saveStoredProfile(profile);
    }
  } catch (e) {
    console.warn('Could not load patient profile from Supabase:', e);
  }

  // Populate form inputs
  const fieldMap = {
    'prof-age': profile.age || '',
    'prof-gender': profile.gender || '',
    'prof-height': profile.height || '',
    'prof-weight': profile.weight || '',
    'prof-blood': profile.blood_type || '',
    'prof-allergies': profile.allergies || '',
    'prof-hereditary': profile.hereditary_diseases || '',
    'prof-chronic': profile.chronic_conditions || '',
    'prof-medications': profile.medications || '',
    'prof-notes': profile.notes || ''
  };

  Object.keys(fieldMap).forEach((id) => {
    const elem = document.getElementById(id);
    if (elem) elem.value = fieldMap[id];
  });
}

function setupFormListener() {
  const form = document.getElementById('form-patient-profile');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const currentLocal = getStoredProfile();

    const profileData = {
      id: currentLocal.id || null,
      user_id: 'default_patient',
      age: document.getElementById('prof-age')?.value ? parseInt(document.getElementById('prof-age').value) : null,
      gender: document.getElementById('prof-gender')?.value || '',
      height: document.getElementById('prof-height')?.value?.trim() || '',
      weight: document.getElementById('prof-weight')?.value?.trim() || '',
      blood_type: document.getElementById('prof-blood')?.value || '',
      allergies: document.getElementById('prof-allergies')?.value?.trim() || '',
      hereditary_diseases: document.getElementById('prof-hereditary')?.value?.trim() || '',
      chronic_conditions: document.getElementById('prof-chronic')?.value?.trim() || '',
      medications: document.getElementById('prof-medications')?.value?.trim() || '',
      notes: document.getElementById('prof-notes')?.value?.trim() || '',
      updatedAt: new Date().toISOString()
    };

    saveStoredProfile(profileData);

    // Sync to Supabase
    try {
      if (profileData.id) {
        await supabase.from('patient_profiles').update({
          age: profileData.age,
          gender: profileData.gender,
          height: profileData.height,
          weight: profileData.weight,
          blood_type: profileData.blood_type,
          allergies: profileData.allergies,
          hereditary_diseases: profileData.hereditary_diseases,
          chronic_conditions: profileData.chronic_conditions,
          medications: profileData.medications,
          notes: profileData.notes,
          updated_at: profileData.updatedAt
        }).eq('id', profileData.id);
      } else {
        const { data, error } = await supabase.from('patient_profiles').insert([{
          user_id: 'default_patient',
          age: profileData.age,
          gender: profileData.gender,
          height: profileData.height,
          weight: profileData.weight,
          blood_type: profileData.blood_type,
          allergies: profileData.allergies,
          hereditary_diseases: profileData.hereditary_diseases,
          chronic_conditions: profileData.chronic_conditions,
          medications: profileData.medications,
          notes: profileData.notes,
          updated_at: profileData.updatedAt
        }]).select();

        if (!error && data && data[0]) {
          profileData.id = data[0].id;
          saveStoredProfile(profileData);
        }
      }
    } catch (err) {
      console.warn('Could not sync profile to Supabase:', err);
    }

    showToast('Perfil médico guardado correctamente');
  });
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
