// Dedicated Alarms View Logic
import './app.js';
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://qqjhadwxboeichxtxree.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFxamhhZHd4Ym9laWNoeHR4cmVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4NDY4ODAsImV4cCI6MjA5NTQyMjg4MH0.dM1VaV-lDPxoPlOHGAIbgfCSE3RMdURcVubq8tTs6yQ';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const ALARMS_STORAGE_KEY = 'ia_agent_alarms_reminders';

let searchQuery = '';

document.addEventListener('DOMContentLoaded', () => {
  renderAlarmsList();
  fetchSupabaseAlarms();

  const searchInput = document.getElementById('search-alarms');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value.toLowerCase().trim();
      renderAlarmsList();
    });
  }
});

function getLocalAlarms() {
  const raw = localStorage.getItem(ALARMS_STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

function saveLocalAlarms(items) {
  localStorage.setItem(ALARMS_STORAGE_KEY, JSON.stringify(items));
  renderAlarmsList();
}

async function fetchSupabaseAlarms() {
  try {
    const { data, error } = await supabase.from('alarms_reminders').select('*').eq('type', 'alarma');
    if (!error && Array.isArray(data)) {
      const allRules = getLocalAlarms();
      const nonAlarms = allRules.filter((r) => r.type !== 'alarma');
      const localAlarms = allRules.filter((r) => r.type === 'alarma');

      const dbAlarms = data.map((a) => ({
        id: 'alg_' + a.id,
        db_id: a.id,
        type: 'alarma',
        category: 'algorithm',
        title: a.name,
        name: a.name,
        message: a.message,
        scheduleMode: a.schedule_mode || 'days',
        days: a.days || [],
        date: a.specific_date || null,
        time: a.time || '07:00',
        useRange: a.use_range || false,
        sound: a.sound || 'Predeterminado',
        soundUrl: a.sound_url || null,
        volume: a.volume || 0.8,
        active: a.active !== false,
        createdAt: a.created_at
      }));

      const mergedAlarms = [...localAlarms];
      dbAlarms.forEach((dbA) => {
        const idx = mergedAlarms.findIndex((lA) => lA.db_id === dbA.db_id || (lA.name && lA.name.toLowerCase() === dbA.name.toLowerCase()));
        if (idx !== -1) {
          mergedAlarms[idx] = { ...dbA, id: mergedAlarms[idx].id };
        } else {
          mergedAlarms.push(dbA);
        }
      });

      localStorage.setItem(ALARMS_STORAGE_KEY, JSON.stringify([...nonAlarms, ...mergedAlarms]));
      renderAlarmsList();
    }
  } catch (e) {
    console.warn('Could not fetch alarms from Supabase:', e);
  }
}

function renderAlarmsList() {
  const container = document.getElementById('alarms-list');
  if (!container) return;

  const allRules = getLocalAlarms();
  let alarms = allRules.filter((r) => r.type === 'alarma');

  if (searchQuery) {
    alarms = alarms.filter((a) =>
      (a.name && a.name.toLowerCase().includes(searchQuery)) ||
      (a.message && a.message.toLowerCase().includes(searchQuery))
    );
  }

  if (alarms.length === 0) {
    container.innerHTML = `<p style="color: #94a3b8; font-size: 0.95rem; text-align: center; padding: 30px;">No tienes alarmas configuradas.</p>`;
    return;
  }

  container.innerHTML = '';
  const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

  alarms.forEach((alarm) => {
    let scheduleText = '';
    if (alarm.scheduleMode === 'days') {
      const daysStr = (alarm.days || []).map((d) => dayNames[d]).join(', ') || 'Todos los días';
      scheduleText = `${daysStr} a las ${alarm.time}`;
    } else {
      scheduleText = `Fecha: ${alarm.date || 'Pendiente'} a las ${alarm.time}`;
    }

    const card = document.createElement('div');
    card.className = 'knowledge-item';
    card.style.background = '#fdf2f8';
    card.style.borderColor = '#fbcfe8';

    card.innerHTML = `
      <div class="knowledge-item-header">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span class="algorithm-card-badge badge-alarma">Alarma</span>
          <div class="knowledge-item-title">${escapeHtml(alarm.name)}</div>
        </div>
        <label class="switch-toggle" title="Activar/Desactivar">
          <input type="checkbox" class="toggle-alarm-active" ${alarm.active ? 'checked' : ''}>
          <span class="switch-slider"></span>
        </label>
      </div>
      <div class="knowledge-item-desc">
        <strong>Hora / Horario:</strong> ${escapeHtml(scheduleText)}<br>
        <strong>Mensaje:</strong> "${escapeHtml(alarm.message || alarm.name)}"
      </div>
      <div class="item-actions">
        ${alarm.soundUrl ? `<button class="btn-edit btn-play-sound">Escuchar Audio</button>` : ''}
        <button class="btn-edit btn-edit-alarm">Editar</button>
        <button class="btn-delete btn-delete-alarm">Eliminar</button>
      </div>
    `;

    card.querySelector('.toggle-alarm-active').addEventListener('change', (e) => toggleAlarmActive(alarm.id, e.target.checked));
    card.querySelector('.btn-delete-alarm').addEventListener('click', () => deleteAlarm(alarm.id));
    card.querySelector('.btn-edit-alarm').addEventListener('click', () => editAlarm(alarm));

    if (alarm.soundUrl) {
      card.querySelector('.btn-play-sound')?.addEventListener('click', () => {
        const audio = new Audio(alarm.soundUrl);
        audio.volume = alarm.volume || 0.8;
        audio.play().catch((e) => console.warn('Audio play error:', e));
      });
    }

    container.appendChild(card);
  });
}

async function toggleAlarmActive(id, isActive) {
  const rules = getLocalAlarms();
  const idx = rules.findIndex((r) => r.id === id);
  if (idx !== -1) {
    rules[idx].active = isActive;
    saveLocalAlarms(rules);

    try {
      if (rules[idx].db_id) {
        await supabase.from('alarms_reminders').update({ active: isActive }).eq('id', rules[idx].db_id);
      } else {
        await supabase.from('alarms_reminders').update({ active: isActive }).eq('name', rules[idx].name);
      }
    } catch (e) {}
  }
}

async function deleteAlarm(id) {
  let rules = getLocalAlarms();
  const target = rules.find((r) => r.id === id);
  rules = rules.filter((r) => r.id !== id);
  saveLocalAlarms(rules);

  if (target) {
    try {
      if (target.db_id) {
        await supabase.from('alarms_reminders').delete().eq('id', target.db_id);
      } else {
        await supabase.from('alarms_reminders').delete().eq('name', target.name);
      }
    } catch (e) {}
  }
}

function editAlarm(alarm) {
  if (window.openRuleEditorModal) {
    window.openRuleEditorModal(alarm, () => {
      renderAlarmsList();
    });
  }
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
