// Consultas Médicas - docs/js/consultas.js
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://qqjhadwxboeichxtxree.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFxamhhZHd4Ym9laWNoeHR4cmVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4NDY4ODAsImV4cCI6MjA5NTQyMjg4MH0.dM1VaV-lDPxoPlOHGAIbgfCSE3RMdURcVubq8tTs6yQ';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const CONSULTATIONS_KEY = 'ia_agent_medical_consultations';
let activeConsultations = [];
let activeModalCid = null;

document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  loadConsultations();
});

function setupEventListeners() {
  const searchInput = document.getElementById('search-consultations');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      renderConsultationsList(e.target.value.trim().toLowerCase());
    });
  }

  const btnCloseModal = document.getElementById('btn-close-detail-modal');
  const modal = document.getElementById('modal-consultation-detail');
  if (btnCloseModal && modal) {
    btnCloseModal.addEventListener('click', () => {
      modal.classList.remove('open');
    });
  }

  const btnContinueModal = document.getElementById('btn-continue-from-modal');
  if (btnContinueModal) {
    btnContinueModal.addEventListener('click', () => {
      if (activeModalCid) {
        window.location.href = `./medical.html?cid=${encodeURIComponent(activeModalCid)}`;
      }
    });
  }
}

function getStoredConsultations() {
  try {
    const raw = localStorage.getItem(CONSULTATIONS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveStoredConsultations(items) {
  try {
    localStorage.setItem(CONSULTATIONS_KEY, JSON.stringify(items));
  } catch (e) {}
}

async function loadConsultations() {
  activeConsultations = getStoredConsultations();

  // Sync from Supabase
  try {
    const { data, error } = await supabase
      .from('medical_consultations')
      .select('*')
      .order('updated_at', { ascending: false });

    if (!error && Array.isArray(data) && data.length > 0) {
      const dbConsultations = data.map((row) => ({
        cid: row.consultation_id,
        title: row.title,
        summary: row.summary,
        messages: row.messages || [],
        status: row.status || 'activa',
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }));

      // Merge DB items with local cache
      dbConsultations.forEach((dbItem) => {
        const idx = activeConsultations.findIndex((c) => c.cid === dbItem.cid);
        if (idx !== -1) {
          activeConsultations[idx] = dbItem;
        } else {
          activeConsultations.push(dbItem);
        }
      });

      activeConsultations.sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
      saveStoredConsultations(activeConsultations);
    }
  } catch (e) {
    console.warn('Could not sync consultations from Supabase:', e);
  }

  renderConsultationsList();
}

function renderConsultationsList(filterQuery = '') {
  const container = document.getElementById('consultations-list');
  if (!container) return;

  let items = activeConsultations;
  if (filterQuery) {
    items = items.filter((c) =>
      (c.title || '').toLowerCase().includes(filterQuery) ||
      (c.summary || '').toLowerCase().includes(filterQuery)
    );
  }

  if (items.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; color: #64748b; padding: 32px 16px; background: #ffffff; border-radius: 18px; border: 1px solid #f1f5f9;">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#0284c7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 8px;"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
        <p style="font-weight: 600; font-size: 1.05rem; color: #1e293b;">No hay consultas médicas registradas</p>
        <p style="font-size: 0.88rem; color: #64748b; margin-top: 4px;">Inicia una nueva consulta con el asistente para guardar tu historial clínico.</p>
        <a href="./medical.html?new=true" class="btn-primary-action" style="width: auto; display: inline-flex; margin-top: 14px; padding: 10px 20px; background: #0284c7; text-decoration: none;">Iniciar Nueva Consulta</a>
      </div>
    `;
    return;
  }

  container.innerHTML = '';
  items.forEach((c) => {
    const card = document.createElement('div');
    card.className = 'knowledge-item';
    card.style.background = '#f0f9ff';
    card.style.borderColor = '#bae6fd';

    const dateStr = new Date(c.updatedAt || c.createdAt || Date.now()).toLocaleDateString('es-ES', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    const msgCount = Array.isArray(c.messages) ? c.messages.length : 0;
    const lastMsg = c.summary || (msgCount > 0 ? c.messages[msgCount - 1].content : 'Sin mensajes');

    card.innerHTML = `
      <div class="knowledge-item-header">
        <span class="knowledge-item-title" style="color: #0369a1; font-size: 1.05rem;">${escapeHtml(c.title || 'Consulta Médica')}</span>
        <span class="item-badge" style="background: #e0f2fe; color: #0284c7;">${dateStr}</span>
      </div>
      <p class="knowledge-item-desc" style="color: #334155; line-height: 1.5;">${escapeHtml(lastMsg)}</p>
      <div style="font-size: 0.8rem; color: #64748b; font-weight: 600;">Interacciones: ${msgCount} mensajes</div>
      <div class="item-actions" style="width: 100%; justify-content: flex-end; gap: 8px; flex-wrap: wrap;">
        <button class="btn-edit btn-continue-item" data-cid="${c.cid}" style="background: #0284c7; color: white;">Continuar Consulta</button>
        <button class="btn-edit btn-view-item" data-cid="${c.cid}">Ver Detalle</button>
        <button class="btn-delete btn-delete-item" data-cid="${c.cid}">Eliminar</button>
      </div>
    `;

    container.appendChild(card);
  });

  // Attach event listeners to buttons
  container.querySelectorAll('.btn-continue-item').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const cid = e.currentTarget.getAttribute('data-cid');
      window.location.href = `./medical.html?cid=${encodeURIComponent(cid)}`;
    });
  });

  container.querySelectorAll('.btn-view-item').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const cid = e.currentTarget.getAttribute('data-cid');
      openConsultationDetailModal(cid);
    });
  });

  container.querySelectorAll('.btn-delete-item').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const cid = e.currentTarget.getAttribute('data-cid');
      await deleteConsultation(cid);
    });
  });
}

function openConsultationDetailModal(cid) {
  const target = activeConsultations.find((c) => c.cid === cid);
  if (!target) return;

  activeModalCid = cid;

  const modal = document.getElementById('modal-consultation-detail');
  const titleElem = document.getElementById('modal-consultation-title');
  const bodyElem = document.getElementById('modal-consultation-body');

  if (titleElem) titleElem.innerText = target.title || 'Detalle de Consulta';

  if (bodyElem) {
    bodyElem.innerHTML = '';
    const msgs = Array.isArray(target.messages) ? target.messages : [];
    if (msgs.length === 0) {
      bodyElem.innerHTML = '<p style="color: #64748b;">No hay mensajes registrados en esta consulta.</p>';
    } else {
      msgs.forEach((m) => {
        const msgDiv = document.createElement('div');
        const isUser = m.role === 'user';
        msgDiv.style.alignSelf = isUser ? 'flex-end' : 'flex-start';
        msgDiv.style.background = isUser ? '#0284c7' : '#f1f5f9';
        msgDiv.style.color = isUser ? '#ffffff' : '#1e293b';
        msgDiv.style.padding = '10px 14px';
        msgDiv.style.borderRadius = '14px';
        msgDiv.style.maxWidth = '85%';
        msgDiv.style.fontSize = '0.9rem';
        msgDiv.style.lineHeight = '1.4';
        msgDiv.innerText = m.content || m.text || '';
        bodyElem.appendChild(msgDiv);
      });
    }
  }

  if (modal) modal.classList.add('open');
}

async function deleteConsultation(cid) {
  activeConsultations = activeConsultations.filter((c) => c.cid !== cid);
  saveStoredConsultations(activeConsultations);
  renderConsultationsList();

  try {
    await supabase.from('medical_consultations').delete().eq('consultation_id', cid);
  } catch (e) {
    console.warn('Could not delete consultation from Supabase:', e);
  }

  showToast('Consulta eliminada correctamente');
}

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
