// Knowledge Management Logic (Aprender)
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://qqjhadwxboeichxtxree.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFxamhhZHd4Ym9laWNoeHR4cmVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4NDY4ODAsImV4cCI6MjA5NTQyMjg4MH0.dM1VaV-lDPxoPlOHGAIbgfCSE3RMdURcVubq8tTs6yQ';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const KNOWLEDGE_STORAGE_KEY = 'ia_agent_knowledge';
const ALARMS_STORAGE_KEY = 'ia_agent_alarms_reminders';

let currentFilter = 'all';
let currentSearchQuery = '';
let currentRuleType = 'alarma';
let currentScheduleMode = 'days';
let uploadedSoundData = null;

document.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  setupFilters();
  setupFileInputDisplay();
  setupAlgorithmUI();
  renderKnowledgeList();

  // Handlers for Column 1 Uploads
  document.getElementById('btn-add-faq')?.addEventListener('click', handleAddFaq);
  document.getElementById('btn-add-sheet')?.addEventListener('click', handleAddSheet);
  document.getElementById('btn-upload-file')?.addEventListener('click', handleUploadFile);
  document.getElementById('btn-add-algorithm')?.addEventListener('click', handleAddAlgorithm);
});

function setupFileInputDisplay() {
  const fileInput = document.getElementById('file-input');
  const nameDisplay = document.getElementById('file-chosen-name');

  if (fileInput && nameDisplay) {
    fileInput.addEventListener('change', () => {
      if (fileInput.files && fileInput.files.length > 0) {
        nameDisplay.textContent = fileInput.files[0].name;
      } else {
        nameDisplay.textContent = 'Sin archivos seleccionados';
      }
    });
  }
}

function setupAlgorithmUI() {
  const typeSelect = document.getElementById('rule-type-select');
  const alarmOnlyFields = document.getElementById('alarm-only-fields');

  if (typeSelect && alarmOnlyFields) {
    const updateVisibility = () => {
      currentRuleType = typeSelect.value || 'recordatorio';
      if (currentRuleType === 'alarma') {
        alarmOnlyFields.style.display = 'flex';
      } else {
        alarmOnlyFields.style.display = 'none';
      }
    };

    typeSelect.addEventListener('change', updateVisibility);
    updateVisibility();
  }

  // Segmented Schedule Buttons (Días vs Fecha)
  const segmentScheduleBtns = document.querySelectorAll('.segment-schedule');
  const daysContainer = document.getElementById('rule-days-container');
  const dateContainer = document.getElementById('rule-date-container');

  segmentScheduleBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      segmentScheduleBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentScheduleMode = btn.getAttribute('data-mode') || 'days';

      if (currentScheduleMode === 'days') {
        if (daysContainer) daysContainer.style.display = 'flex';
        if (dateContainer) dateContainer.style.display = 'none';
      } else {
        if (daysContainer) daysContainer.style.display = 'none';
        if (dateContainer) dateContainer.style.display = 'flex';
      }
    });
  });

  // Day Chips Toggle
  const dayChips = document.querySelectorAll('.day-chip');
  dayChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      chip.classList.toggle('active');
    });
  });

  // Time Range Checkbox Toggle
  const useRangeCheckbox = document.getElementById('rule-use-range');
  const rangeContainer = document.getElementById('rule-range-container');
  if (useRangeCheckbox && rangeContainer) {
    useRangeCheckbox.addEventListener('change', () => {
      rangeContainer.style.display = useRangeCheckbox.checked ? 'flex' : 'none';
    });
  }

  // Sound File Loader
  const soundInput = document.getElementById('rule-sound-input');
  const soundNameDisplay = document.getElementById('rule-sound-name');
  if (soundInput && soundNameDisplay) {
    soundInput.addEventListener('change', () => {
      if (soundInput.files && soundInput.files.length > 0) {
        const soundFile = soundInput.files[0];
        soundNameDisplay.textContent = soundFile.name;

        const reader = new FileReader();
        reader.onload = (e) => {
          uploadedSoundData = {
            name: soundFile.name,
            dataUrl: e.target.result
          };
        };
        reader.readAsDataURL(soundFile);
      } else {
        uploadedSoundData = null;
        soundNameDisplay.textContent = 'Sonido predeterminado';
      }
    });
  }
}

function setupTabs() {
  const tabBtns = document.querySelectorAll('.tab-btn');
  tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabBtns.forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach((tc) => tc.classList.remove('active'));

      btn.classList.add('active');
      const targetId = btn.getAttribute('data-tab');
      document.getElementById(targetId)?.classList.add('active');
    });
  });
}

function setupFilters() {
  const filterChips = document.querySelectorAll('.filter-chip');
  filterChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      filterChips.forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      currentFilter = chip.getAttribute('data-filter') || 'all';
      renderKnowledgeList();
    });
  });

  const searchInput = document.getElementById('search-title');
  searchInput?.addEventListener('input', (e) => {
    currentSearchQuery = e.target.value.toLowerCase().trim();
    renderKnowledgeList();
  });
}

function getLocalKnowledge() {
  const data = localStorage.getItem(KNOWLEDGE_STORAGE_KEY);
  return data ? JSON.parse(data) : [];
}

function getLocalAlarms() {
  const data = localStorage.getItem(ALARMS_STORAGE_KEY);
  return data ? JSON.parse(data) : [];
}

function saveLocalAlarms(items) {
  localStorage.setItem(ALARMS_STORAGE_KEY, JSON.stringify(items));
  renderKnowledgeList();
}

function saveLocalKnowledge(items) {
  localStorage.setItem(KNOWLEDGE_STORAGE_KEY, JSON.stringify(items));
  renderKnowledgeList();
}

async function handleAddFaq() {
  const questionInput = document.getElementById('faq-question');
  const answerInput = document.getElementById('faq-answer');

  const question = questionInput.value.trim();
  const answer = answerInput.value.trim();

  if (!question || !answer) {
    alert('Por favor completa el titulo/pregunta y la descripcion.');
    return;
  }

  const newItem = {
    id: 'faq_' + Date.now(),
    type: 'faq',
    title: question,
    content: answer,
    createdAt: new Date().toISOString()
  };

  saveItem(newItem);
  questionInput.value = '';
  answerInput.value = '';
  showToast('FAQ guardada con exito');
}

async function handleAddSheet() {
  const titleInput = document.getElementById('doc-title');
  const urlInput = document.getElementById('doc-url');
  const descInput = document.getElementById('doc-desc');

  const title = titleInput.value.trim();
  const url = urlInput.value.trim();
  const desc = descInput.value.trim();

  if (!title || !url) {
    alert('Por favor indica el titulo y la URL.');
    return;
  }

  let fetchedContent = desc || url;

  if (url.includes('pub?output=csv') || url.includes('.csv')) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        fetchedContent = (desc ? desc + '\n\n' : '') + (await res.text());
      }
    } catch (e) {
      console.warn('Could not fetch CSV content directly:', e);
    }
  }

  const newItem = {
    id: 'sheet_' + Date.now(),
    type: 'sheet',
    title: title,
    content: fetchedContent,
    url: url,
    createdAt: new Date().toISOString()
  };

  saveItem(newItem);
  titleInput.value = '';
  urlInput.value = '';
  descInput.value = '';
  showToast('Sheet/URL vinculada con exito');
}

async function handleUploadFile() {
  const titleInput = document.getElementById('file-title');
  const fileInput = document.getElementById('file-input');
  const descInput = document.getElementById('file-desc');

  const file = fileInput.files[0];
  const title = titleInput.value.trim() || (file ? file.name : '');
  const desc = descInput.value.trim();

  if (!file) {
    alert('Por favor selecciona un archivo para cargar.');
    return;
  }

  const reader = new FileReader();
  reader.onload = async (e) => {
    const textContent = e.target.result;
    const newItem = {
      id: 'file_' + Date.now(),
      type: 'file',
      title: title,
      content: (desc ? desc + '\n\n' : '') + textContent,
      createdAt: new Date().toISOString()
    };

    saveItem(newItem);
    titleInput.value = '';
    fileInput.value = '';
    descInput.value = '';
    showToast('Archivo cargado con exito');
  };

  reader.readAsText(file);
}

async function handleAddAlgorithm() {
  const nameInput = document.getElementById('rule-name');
  const msgInput = document.getElementById('rule-message');
  const dateInput = document.getElementById('rule-date');
  const timeInput = document.getElementById('rule-time');
  const useRangeCB = document.getElementById('rule-use-range');
  const rangeStart = document.getElementById('rule-range-start');
  const rangeEnd = document.getElementById('rule-range-end');
  const volumeRange = document.getElementById('rule-volume');

  const name = nameInput.value.trim();
  const message = msgInput.value.trim();

  if (!name) {
    alert('Por favor especifica un título para la regla / recordatorio.');
    return;
  }

  // Get active days if in days mode
  const activeDays = [];
  if (currentScheduleMode === 'days') {
    document.querySelectorAll('.day-chip.active').forEach((chip) => {
      activeDays.push(parseInt(chip.getAttribute('data-day')));
    });
  }

  // Get stop actions for Alarma
  const stopActions = [];
  if (currentRuleType === 'alarma') {
    document.querySelectorAll('.stop-action-cb:checked').forEach((cb) => {
      stopActions.push(cb.value);
    });
  }

  const newRule = {
    id: 'alg_' + Date.now(),
    type: currentRuleType, // 'alarma' or 'recordatorio'
    category: 'algorithm',
    title: name,
    name: name,
    message: message || name,
    scheduleMode: currentScheduleMode, // 'days' or 'date'
    days: activeDays,
    date: currentScheduleMode === 'date' ? dateInput.value : null,
    time: timeInput.value || '08:00',
    useRange: useRangeCB.checked,
    rangeStart: useRangeCB.checked ? rangeStart.value : null,
    rangeEnd: useRangeCB.checked ? rangeEnd.value : null,
    sound: currentRuleType === 'alarma' ? (uploadedSoundData ? uploadedSoundData.name : 'Predeterminado') : null,
    soundUrl: currentRuleType === 'alarma' ? (uploadedSoundData ? uploadedSoundData.dataUrl : null) : null,
    volume: currentRuleType === 'alarma' ? parseInt(volumeRange.value) / 100 : 0.8,
    stopActions: currentRuleType === 'alarma' ? stopActions : ['button'],
    active: true,
    lastExecuted: null,
    createdAt: new Date().toISOString()
  };

  saveAlgorithmItem(newRule);

  // Clear inputs
  nameInput.value = '';
  msgInput.value = '';
  uploadedSoundData = null;
  const soundNameDisplay = document.getElementById('rule-sound-name');
  if (soundNameDisplay) soundNameDisplay.textContent = 'Sonido predeterminado';

  showToast(`${currentRuleType === 'alarma' ? 'Alarma' : 'Recordatorio'} guardado con exito`);
}

function saveAlgorithmItem(newRule) {
  const rules = getLocalAlarms();
  rules.push(newRule);
  saveLocalAlarms(rules);

  // Sync Supabase
  try {
    supabase.from('alarms_reminders').insert([{
      type: newRule.type,
      name: newRule.name,
      message: newRule.message,
      schedule_mode: newRule.scheduleMode,
      days: newRule.days,
      specific_date: newRule.date,
      time: newRule.time,
      timezone: newRule.timezone,
      use_range: newRule.useRange,
      range_start: newRule.rangeStart,
      range_end: newRule.rangeEnd,
      range_limit: newRule.rangeLimit,
      voice: newRule.voice,
      sound: newRule.sound,
      sound_url: newRule.soundUrl,
      volume: newRule.volume,
      repeat: newRule.repeat,
      repeat_interval: newRule.repeatInterval,
      max_repeats: newRule.maxRepeats,
      interaction: newRule.interaction,
      active: newRule.active
    }]).then(({ error }) => {
      if (error) console.log('Supabase alarms sync info:', error.message);
    });
  } catch (e) {
    console.log('Supabase alarms sync error:', e);
  }
}

function saveItem(newItem) {
  const items = getLocalKnowledge();
  items.push(newItem);
  saveLocalKnowledge(items);

  // Sync Supabase
  try {
    supabase.from('knowledge').insert([{
      type: newItem.type,
      title: newItem.title,
      content: newItem.content,
      url: newItem.url || null
    }]).then(({ error }) => {
      if (error) console.log('Supabase sync info:', error.message);
    });
  } catch (e) {
    console.log('Supabase sync error:', e);
  }
}

function renderKnowledgeList() {
  const container = document.getElementById('knowledge-list');
  if (!container) return;

  let knowledgeItems = getLocalKnowledge().map((i) => ({ ...i, category: 'knowledge' }));
  let alarmItems = getLocalAlarms().map((a) => ({ ...a, category: 'algorithm' }));

  let combined = [];

  if (currentFilter === 'all') {
    combined = [...knowledgeItems, ...alarmItems];
  } else if (currentFilter === 'algorithm') {
    combined = alarmItems;
  } else {
    combined = knowledgeItems.filter((i) => i.type === currentFilter);
  }

  // Filter by search text
  if (currentSearchQuery) {
    combined = combined.filter(
      (item) =>
        (item.title && item.title.toLowerCase().includes(currentSearchQuery)) ||
        (item.name && item.name.toLowerCase().includes(currentSearchQuery)) ||
        (item.content && item.content.toLowerCase().includes(currentSearchQuery)) ||
        (item.message && item.message.toLowerCase().includes(currentSearchQuery))
    );
  }

  if (combined.length === 0) {
    container.innerHTML = `<p style="color: #94a3b8; font-size: 0.9rem; text-align: center; padding: 20px;">No se encontraron registros para el filtro actual.</p>`;
    return;
  }

  container.innerHTML = '';

  combined.forEach((item) => {
    const div = document.createElement('div');
    div.className = 'knowledge-item';

    if (item.category === 'algorithm') {
      const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
      let scheduleText = '';
      if (item.scheduleMode === 'days') {
        const daysStr = (item.days || []).map((d) => dayNames[d]).join(', ') || 'Todos los días';
        scheduleText = `${daysStr} a las ${item.time}`;
      } else {
        scheduleText = `Fecha: ${item.date || 'Pendiente'} a las ${item.time}`;
      }

      if (item.useRange) {
        scheduleText += ` (Rango: ${item.rangeStart} - ${item.rangeEnd}, Max: ${item.rangeLimit})`;
      }

      const badgeClass = item.type === 'alarma' ? 'badge-alarma' : 'badge-recordatorio';

      div.innerHTML = `
        <div class="knowledge-item-header">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="algorithm-card-badge ${badgeClass}">${escapeHtml(item.type)}</span>
            <div class="knowledge-item-title">${escapeHtml(item.name || item.title)}</div>
          </div>
          <label class="switch-toggle" title="Activar/Desactivar">
            <input type="checkbox" class="toggle-rule-active" data-id="${item.id}" ${item.active ? 'checked' : ''}>
            <span class="switch-slider"></span>
          </label>
        </div>
        <div class="knowledge-item-desc">
          <strong>Horario:</strong> ${escapeHtml(scheduleText)}<br>
          <strong>Mensaje:</strong> "${escapeHtml(item.message)}"
        </div>
        <div class="item-actions">
          ${item.soundUrl ? `<button class="btn-edit btn-play-sound" data-id="${item.id}">Escuchar Sonido</button>` : ''}
          <button class="btn-edit" data-id="${item.id}">Editar</button>
          <button class="btn-delete" data-id="${item.id}">Eliminar</button>
        </div>
      `;

      div.querySelector('.toggle-rule-active').addEventListener('change', (e) => toggleRuleActive(item.id, e.target.checked));
      div.querySelector('.btn-delete').addEventListener('click', () => deleteAlgorithmItem(item.id));
      div.querySelector('.btn-edit').addEventListener('click', () => editAlgorithmItem(item));
      if (item.soundUrl) {
        div.querySelector('.btn-play-sound')?.addEventListener('click', () => {
          const audio = new Audio(item.soundUrl);
          audio.volume = item.volume || 0.8;
          audio.play().catch((e) => console.warn('Could not play preview sound:', e));
        });
      }

    } else {
      // Standard Knowledge item
      div.innerHTML = `
        <div class="knowledge-item-header">
          <div class="knowledge-item-title">${escapeHtml(item.title)}</div>
          <span style="font-size: 0.75rem; color: #94a3b8; font-weight: 500;">${item.type.toUpperCase()}</span>
        </div>
        <div class="knowledge-item-desc">${escapeHtml((item.content || '').substring(0, 140))}${(item.content || '').length > 140 ? '...' : ''}</div>
        <div class="item-actions">
          <button class="btn-edit" data-id="${item.id}">Editar</button>
          <button class="btn-delete" data-id="${item.id}">Eliminar</button>
        </div>
      `;

      div.querySelector('.btn-delete').addEventListener('click', () => deleteItem(item.id));
      div.querySelector('.btn-edit').addEventListener('click', () => editItem(item));
    }

    container.appendChild(div);
  });
}

function toggleRuleActive(id, isActive) {
  let rules = getLocalAlarms();
  const index = rules.findIndex((r) => r.id === id);
  if (index !== -1) {
    rules[index].active = isActive;
    saveLocalAlarms(rules);
    showToast(isActive ? 'Regla activada' : 'Regla desactivada');
  }
}

function deleteAlgorithmItem(id) {
  if (!confirm('Esta seguro de eliminar este algoritmo/regla?')) return;
  let rules = getLocalAlarms();
  rules = rules.filter((r) => r.id !== id);
  saveLocalAlarms(rules);
  showToast('Regla eliminada');
}

function editAlgorithmItem(rule) {
  const newName = prompt('Editar nombre de la regla:', rule.name || rule.title);
  if (newName === null) return;

  const newMsg = prompt('Editar mensaje hablado:', rule.message);
  if (newMsg === null) return;

  const newTime = prompt('Editar hora de ejecucion (HH:MM):', rule.time);
  if (newTime === null) return;

  let rules = getLocalAlarms();
  const index = rules.findIndex((r) => r.id === rule.id);
  if (index !== -1) {
    rules[index].name = newName.trim() || rule.name;
    rules[index].title = newName.trim() || rule.title;
    rules[index].message = newMsg.trim() || rule.message;
    rules[index].time = newTime.trim() || rule.time;
    saveLocalAlarms(rules);
    showToast('Regla actualizada');
  }
}

function deleteItem(id) {
  if (!confirm('Esta seguro de eliminar este registro?')) return;
  let items = getLocalKnowledge();
  items = items.filter((item) => item.id !== id);
  saveLocalKnowledge(items);
  showToast('Registro eliminado');
}

function editItem(item) {
  const newTitle = prompt('Editar titulo:', item.title);
  if (newTitle === null) return;

  const newContent = prompt('Editar descripcion / contenido:', item.content);
  if (newContent === null) return;

  let items = getLocalKnowledge();
  const index = items.findIndex((i) => i.id === item.id);
  if (index !== -1) {
    items[index].title = newTitle.trim() || item.title;
    items[index].content = newContent.trim() || item.content;
    saveLocalKnowledge(items);
    showToast('Registro actualizado');
  }
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast-msg';
  toast.innerText = message;
  document.body.appendChild(toast);
  setTimeout(() => {
    if (toast.parentNode) toast.parentNode.removeChild(toast);
  }, 2200);
}
