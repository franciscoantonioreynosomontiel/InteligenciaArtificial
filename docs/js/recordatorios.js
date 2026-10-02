// Dedicated Reminders View Logic
import './app.js';
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://qqjhadwxboeichxtxree.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFxamhhZHd4Ym9laWNoeHR4cmVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4NDY4ODAsImV4cCI6MjA5NTQyMjg4MH0.dM1VaV-lDPxoPlOHGAIbgfCSE3RMdURcVubq8tTs6yQ';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const ALARMS_STORAGE_KEY = 'ia_agent_alarms_reminders';

let searchQuery = '';

document.addEventListener('DOMContentLoaded', () => {
  renderRemindersList();
  fetchSupabaseReminders();

  const searchInput = document.getElementById('search-reminders');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value.toLowerCase().trim();
      renderRemindersList();
    });
  }

  const btnCreate = document.getElementById('btn-create-reminder');
  if (btnCreate) {
    btnCreate.addEventListener('click', () => {
      if (window.openRuleEditorModal) {
        window.openRuleEditorModal({ type: 'recordatorio' }, () => {
          renderRemindersList();
        });
      }
    });
  }
});

function getLocalReminders() {
  const raw = localStorage.getItem(ALARMS_STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

function saveLocalReminders(items) {
  localStorage.setItem(ALARMS_STORAGE_KEY, JSON.stringify(items));
  renderRemindersList();
}

async function fetchSupabaseReminders() {
  try {
    const { data, error } = await supabase.from('alarms_reminders').select('*').eq('type', 'recordatorio');
    if (!error && Array.isArray(data)) {
      const currentRules = getLocalReminders();
      const nonReminders = currentRules.filter((r) => r.type !== 'recordatorio');
      const localReminders = currentRules.filter((r) => r.type === 'recordatorio');

      const dbReminders = data.map((r) => ({
        id: 'alg_' + r.id,
        db_id: r.id,
        type: 'recordatorio',
        category: 'algorithm',
        title: r.name,
        name: r.name,
        message: r.message,
        scheduleMode: r.schedule_mode || 'days',
        days: r.days || [],
        date: r.specific_date || null,
        time: r.time || '08:00',
        useRange: r.use_range || false,
        active: r.active !== false,
        createdAt: r.created_at
      }));

      const mergedMap = new Map();
      localReminders.forEach((lR) => mergedMap.set(lR.id, lR));
      dbReminders.forEach((dbR) => {
        const localMatch = localReminders.find((lR) => lR.db_id === dbR.db_id || (lR.name && lR.name.toLowerCase() === dbR.name.toLowerCase()));
        if (localMatch) {
          mergedMap.set(localMatch.id, { ...dbR, id: localMatch.id, active: localMatch.active });
        } else {
          mergedMap.set(dbR.id, dbR);
        }
      });

      const updatedAll = [...nonReminders, ...Array.from(mergedMap.values())];
      localStorage.setItem(ALARMS_STORAGE_KEY, JSON.stringify(updatedAll));
      renderRemindersList();
    }
  } catch (e) {
    console.warn('Could not fetch reminders from Supabase:', e);
  }
}

function renderRemindersList() {
  const container = document.getElementById('reminders-list');
  if (!container) return;

  const allRules = getLocalReminders();
  let reminders = allRules.filter((r) => r.type === 'recordatorio');

  if (searchQuery) {
    reminders = reminders.filter((r) =>
      (r.name && r.name.toLowerCase().includes(searchQuery)) ||
      (r.message && r.message.toLowerCase().includes(searchQuery))
    );
  }

  if (reminders.length === 0) {
    container.innerHTML = `<p style="color: #94a3b8; font-size: 0.95rem; text-align: center; padding: 30px;">No tienes recordatorios guardados.</p>`;
    return;
  }

  container.innerHTML = '';
  const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

  reminders.forEach((reminder) => {
    let scheduleText = '';
    if (reminder.scheduleMode === 'days') {
      const daysStr = (reminder.days || []).map((d) => dayNames[d]).join(', ') || 'Todos los días';
      scheduleText = `${daysStr} a las ${reminder.time}`;
    } else {
      scheduleText = `Fecha: ${reminder.date || 'Pendiente'} a las ${reminder.time}`;
    }

    const card = document.createElement('div');
    card.className = 'knowledge-item';
    card.style.background = '#f0f9ff';
    card.style.borderColor = '#bae6fd';

    card.innerHTML = `
      <div class="knowledge-item-header">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span class="algorithm-card-badge badge-recordatorio">Recordatorio</span>
          <div class="knowledge-item-title">${escapeHtml(reminder.name)}</div>
        </div>
        <label class="switch-toggle" title="Activar/Desactivar">
          <input type="checkbox" class="toggle-reminder-active" ${reminder.active ? 'checked' : ''}>
          <span class="switch-slider"></span>
        </label>
      </div>
      <div class="knowledge-item-desc">
        <strong>Programación:</strong> ${escapeHtml(scheduleText)}<br>
        <strong>Mensaje / Asunto:</strong> "${escapeHtml(reminder.message || reminder.name)}"
      </div>
      <div class="item-actions">
        <button class="btn-edit btn-edit-reminder">Editar</button>
        <button class="btn-delete btn-delete-reminder">Eliminar</button>
      </div>
    `;

    card.querySelector('.toggle-reminder-active').addEventListener('change', (e) => toggleReminderActive(reminder.id, e.target.checked));
    card.querySelector('.btn-delete-reminder').addEventListener('click', () => deleteReminder(reminder.id));
    card.querySelector('.btn-edit-reminder').addEventListener('click', () => editReminder(reminder));

    container.appendChild(card);
  });
}

async function toggleReminderActive(id, isActive) {
  const rules = getLocalReminders();
  const idx = rules.findIndex((r) => r.id === id);
  if (idx !== -1) {
    rules[idx].active = isActive;
    saveLocalReminders(rules);

    try {
      if (rules[idx].db_id) {
        await supabase.from('alarms_reminders').update({ active: isActive }).eq('id', rules[idx].db_id);
      } else {
        await supabase.from('alarms_reminders').update({ active: isActive }).eq('name', rules[idx].name);
      }
    } catch (e) {}
  }
}

async function deleteReminder(id) {
  let rules = getLocalReminders();
  const target = rules.find((r) => r.id === id);
  rules = rules.filter((r) => r.id !== id);
  saveLocalReminders(rules);

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

function editReminder(reminder) {
  if (window.openRuleEditorModal) {
    window.openRuleEditorModal(reminder, () => {
      renderRemindersList();
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
