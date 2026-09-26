// Knowledge Management Logic (Aprender)
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://qqjhadwxboeichxtxree.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFxamhhZHd4Ym9laWNoeHR4cmVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4NDY4ODAsImV4cCI6MjA5NTQyMjg4MH0.dM1VaV-lDPxoPlOHGAIbgfCSE3RMdURcVubq8tTs6yQ';

// Initialize Supabase Client
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const KNOWLEDGE_STORAGE_KEY = 'ia_agent_knowledge';

document.addEventListener('DOMContentLoaded', () => {
  renderKnowledgeList();

  const btnAddFaq = document.getElementById('btn-add-faq');
  if (btnAddFaq) {
    btnAddFaq.addEventListener('click', handleAddFaq);
  }

  const btnAddDoc = document.getElementById('btn-add-doc');
  if (btnAddDoc) {
    btnAddDoc.addEventListener('click', handleAddDoc);
  }
});

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
    alert('Por favor completa tanto la pregunta como la respuesta.');
    return;
  }

  const newItem = {
    id: 'faq_' + Date.now(),
    type: 'faq',
    title: question,
    content: answer,
    createdAt: new Date().toISOString()
  };

  // Save Local
  const items = getLocalKnowledge();
  items.push(newItem);
  saveLocalKnowledge(items);

  // Try sync with Supabase if table exists
  try {
    await supabase.from('knowledge').insert([{
      type: 'faq',
      title: question,
      content: answer
    }]);
  } catch (e) {
    console.log('Supabase sync info:', e.message);
  }

  questionInput.value = '';
  answerInput.value = '';
  showToast('FAQ guardada con éxito ✨');
}

async function handleAddDoc() {
  const titleInput = document.getElementById('doc-title');
  const urlInput = document.getElementById('doc-url');

  const title = titleInput.value.trim();
  const url = urlInput.value.trim();

  if (!title || !url) {
    alert('Por favor completa el nombre y la URL.');
    return;
  }

  let fetchedContent = url;

  // If it's a CSV or Google Sheets published URL, attempt to pre-fetch text content
  if (url.includes('pub?output=csv') || url.includes('.csv')) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        fetchedContent = await res.text();
      }
    } catch (err) {
      console.warn('Could not fetch CSV content directly:', err);
    }
  }

  const newItem = {
    id: 'doc_' + Date.now(),
    type: 'doc',
    title: title,
    content: fetchedContent,
    url: url,
    createdAt: new Date().toISOString()
  };

  const items = getLocalKnowledge();
  items.push(newItem);
  saveLocalKnowledge(items);

  // Sync Supabase
  try {
    await supabase.from('knowledge').insert([{
      type: 'doc',
      title: title,
      content: fetchedContent,
      url: url
    }]);
  } catch (e) {
    console.log('Supabase sync info:', e.message);
  }

  titleInput.value = '';
  urlInput.value = '';
  showToast('Documento vinculado con éxito 🔗');
}

function renderKnowledgeList() {
  const container = document.getElementById('knowledge-list');
  if (!container) return;

  const items = getLocalKnowledge();

  if (items.length === 0) {
    container.innerHTML = `<p style="color: #94a3b8; font-size: 0.9rem; text-align: center; padding: 12px;">Aún no se ha registrado ningún conocimiento.</p>`;
    return;
  }

  container.innerHTML = '';

  items.forEach((item) => {
    const div = document.createElement('div');
    div.className = 'knowledge-item';

    const isFaq = item.type === 'faq';
    const icon = isFaq ? '❓' : '📊';

    div.innerHTML = `
      <div style="flex: 1; padding-right: 12px;">
        <div class="knowledge-item-title">${icon} ${escapeHtml(item.title)}</div>
        <div class="knowledge-item-desc">${escapeHtml(item.content.substring(0, 100))}${item.content.length > 100 ? '...' : ''}</div>
      </div>
      <button class="btn-delete" data-id="${item.id}">🗑️ Borrar</button>
    `;

    const deleteBtn = div.querySelector('.btn-delete');
    deleteBtn.addEventListener('click', () => deleteKnowledge(item.id));

    container.appendChild(div);
  });
}

function deleteKnowledge(id) {
  let items = getLocalKnowledge();
  items = items.filter(item => item.id !== id);
  saveLocalKnowledge(items);
  showToast('Eliminado');
}

function escapeHtml(str) {
  return String(str)
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
