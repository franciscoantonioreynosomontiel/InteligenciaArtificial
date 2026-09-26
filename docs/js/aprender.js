// Knowledge Management Logic (Aprender)
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://qqjhadwxboeichxtxree.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFxamhhZHd4Ym9laWNoeHR4cmVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4NDY4ODAsImV4cCI6MjA5NTQyMjg4MH0.dM1VaV-lDPxoPlOHGAIbgfCSE3RMdURcVubq8tTs6yQ';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const KNOWLEDGE_STORAGE_KEY = 'ia_agent_knowledge';

let currentFilter = 'all';
let currentSearchQuery = '';

document.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  setupFilters();
  renderKnowledgeList();

  // Handlers for Column 1 Uploads
  document.getElementById('btn-add-faq')?.addEventListener('click', handleAddFaq);
  document.getElementById('btn-add-sheet')?.addEventListener('click', handleAddSheet);
  document.getElementById('btn-upload-file')?.addEventListener('click', handleUploadFile);
});

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
    alert('Por favor completa el título/pregunta y la descripción.');
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
  showToast('FAQ guardada con éxito ✨');
}

async function handleAddSheet() {
  const titleInput = document.getElementById('doc-title');
  const urlInput = document.getElementById('doc-url');
  const descInput = document.getElementById('doc-desc');

  const title = titleInput.value.trim();
  const url = urlInput.value.trim();
  const desc = descInput.value.trim();

  if (!title || !url) {
    alert('Por favor indica el título y la URL.');
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
  showToast('Sheet/URL vinculada con éxito 📊');
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
    showToast('Archivo cargado con éxito 📁');
  };

  reader.readAsText(file);
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

  let items = getLocalKnowledge();

  // Filter by type chip
  if (currentFilter !== 'all') {
    items = items.filter((item) => item.type === currentFilter);
  }

  // Filter by search text
  if (currentSearchQuery) {
    items = items.filter(
      (item) =>
        item.title.toLowerCase().includes(currentSearchQuery) ||
        item.content.toLowerCase().includes(currentSearchQuery)
    );
  }

  if (items.length === 0) {
    container.innerHTML = `<p style="color: #94a3b8; font-size: 0.9rem; text-align: center; padding: 20px;">No se encontraron registros para el filtro actual.</p>`;
    return;
  }

  container.innerHTML = '';

  items.forEach((item) => {
    const div = document.createElement('div');
    div.className = 'knowledge-item';

    let icon = '❓';
    if (item.type === 'sheet') icon = '📊';
    if (item.type === 'file') icon = '📁';

    div.innerHTML = `
      <div class="knowledge-item-header">
        <div class="knowledge-item-title">${icon} ${escapeHtml(item.title)}</div>
        <span style="font-size: 0.75rem; color: #94a3b8; font-weight: 500;">${item.type.toUpperCase()}</span>
      </div>
      <div class="knowledge-item-desc">${escapeHtml(item.content.substring(0, 140))}${item.content.length > 140 ? '...' : ''}</div>
      <div class="item-actions">
        <button class="btn-edit" data-id="${item.id}">✏️ Editar</button>
        <button class="btn-delete" data-id="${item.id}">🗑️ Eliminar</button>
      </div>
    `;

    div.querySelector('.btn-delete').addEventListener('click', () => deleteItem(item.id));
    div.querySelector('.btn-edit').addEventListener('click', () => editItem(item));

    container.appendChild(div);
  });
}

function deleteItem(id) {
  if (!confirm('¿Estás seguro de eliminar este registro?')) return;
  let items = getLocalKnowledge();
  items = items.filter((item) => item.id !== id);
  saveLocalKnowledge(items);
  showToast('Registro eliminado');
}

function editItem(item) {
  const newTitle = prompt('Editar título:', item.title);
  if (newTitle === null) return;

  const newContent = prompt('Editar descripción / contenido:', item.content);
  if (newContent === null) return;

  let items = getLocalKnowledge();
  const index = items.findIndex((i) => i.id === item.id);
  if (index !== -1) {
    items[index].title = newTitle.trim() || item.title;
    items[index].content = newContent.trim() || item.content;
    saveLocalKnowledge(items);
    showToast('Registro actualizado ✨');
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
