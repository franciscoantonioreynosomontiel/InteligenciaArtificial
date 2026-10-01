// Post-it Sticky Notes Management Logic
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { uploadToCloudinary } from './cloudinary.js';

const SUPABASE_URL = 'https://qqjhadwxboeichxtxree.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFxamhhZHd4Ym9laWNoeHR4cmVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4NDY4ODAsImV4cCI6MjA5NTQyMjg4MH0.dM1VaV-lDPxoPlOHGAIbgfCSE3RMdURcVubq8tTs6yQ';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const NOTES_STORAGE_KEY = 'ia_agent_notes';

let notes = [];
let editingNoteId = null;
let activeViewingNote = null;
let selectedColor = '#fef08a';
let uploadedImageUrl = null;
let uploadedImageBase64 = null;
let modalChecklistItems = [];

// Drawing Canvas State
let isDrawing = false;
let canvasCtx = null;
let canvasElem = null;

document.addEventListener('DOMContentLoaded', () => {
  setupDrawingCanvas();
  setupModalEvents();
  loadLocalNotes();
  fetchSupabaseNotes();
});

function loadLocalNotes() {
  const raw = localStorage.getItem(NOTES_STORAGE_KEY);
  if (raw) {
    try {
      notes = JSON.parse(raw);
    } catch (e) {
      notes = [];
    }
  }
  renderNotesBoard();
}

async function fetchSupabaseNotes() {
  try {
    const { data, error } = await supabase.from('notes').select('*');
    if (!error && Array.isArray(data) && data.length > 0) {
      notes = data.map((n) => ({
        id: 'note_' + n.id,
        db_id: n.id,
        title: n.title,
        content: n.content,
        items: Array.isArray(n.items) ? n.items : [],
        color: n.color || '#fef08a',
        imageUrl: n.image_url,
        drawingData: n.drawing_data,
        width: n.width || 260,
        height: n.height || 260,
        createdAt: n.created_at
      }));
      localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(notes));
      renderNotesBoard();
    }
  } catch (e) {
    console.warn('Could not fetch notes from Supabase:', e);
  }
}

function saveLocalNotes() {
  localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(notes));
  renderNotesBoard();
}

function renderNotesBoard() {
  const board = document.getElementById('notes-board');
  if (!board) return;

  board.innerHTML = '';

  // 1. Create Post-it "+" Button Card (Exact same size as a post-it note)
  const addCard = document.createElement('div');
  addCard.className = 'postit-card add-postit-card';
  addCard.innerHTML = `
    <div class="add-postit-inner">
      <span class="add-plus-icon">+</span>
      <span class="add-plus-text">Nueva Nota</span>
    </div>
  `;
  addCard.addEventListener('click', () => openNoteModal());
  board.appendChild(addCard);

  // 2. Render existing Post-it Notes
  notes.forEach((note) => {
    const card = document.createElement('div');
    card.className = 'postit-card';
    card.style.backgroundColor = note.color || '#fef08a';

    if (note.width) {
      card.style.width = `${note.width}px`;
      card.style.minHeight = `${note.height || note.width}px`;
    }

    let imageHtml = '';
    if (note.imageUrl) {
      imageHtml = `<div class="postit-image-box"><img src="${escapeHtml(note.imageUrl)}" alt="Imagen de nota"></div>`;
    }

    let drawingHtml = '';
    if (note.drawingData) {
      drawingHtml = `<div class="postit-drawing-box"><img src="${note.drawingData}" alt="Dibujo de nota"></div>`;
    }

    card.style.cursor = 'pointer';

    let checklistHtml = '';
    if (Array.isArray(note.items) && note.items.length > 0) {
      checklistHtml = `<div class="postit-checklist">` +
        note.items.map((it, itemIdx) => `
          <label class="postit-checklist-item ${it.completed ? 'completed' : ''}" data-idx="${itemIdx}">
            <input type="checkbox" class="postit-card-checkbox" ${it.completed ? 'checked' : ''} data-note-id="${note.id}" data-item-idx="${itemIdx}">
            <span>${escapeHtml(it.text)}</span>
          </label>
        `).join('') +
        `</div>`;
    }

    card.innerHTML = `
      <div class="postit-header">
        <span class="postit-pin">📌</span>
        <div class="postit-title">${escapeHtml(note.title)}</div>
        <div class="postit-actions">
          <button class="btn-postit-action btn-edit-note" title="Editar">✏️</button>
          <button class="btn-postit-action btn-delete-note" title="Eliminar">🗑️</button>
        </div>
      </div>

      <div class="postit-body">
        ${note.content ? `<p class="postit-text">${escapeHtml(note.content)}</p>` : ''}
        ${checklistHtml}
        ${drawingHtml}
        ${imageHtml}
      </div>
    `;

    // Interactive Checkboxes on Card
    card.querySelectorAll('.postit-card-checkbox').forEach((cb) => {
      cb.addEventListener('click', (e) => {
        e.stopPropagation();
      });
      cb.addEventListener('change', (e) => {
        e.stopPropagation();
        const itemIdx = parseInt(cb.getAttribute('data-item-idx'));
        if (Array.isArray(note.items) && note.items[itemIdx] !== undefined) {
          note.items[itemIdx].completed = cb.checked;
          saveLocalNotes();
          syncUpdateNoteToSupabase(note);
        }
      });
    });

    card.addEventListener('click', () => {
      openNoteViewModal(note);
    });

    card.querySelector('.btn-edit-note').addEventListener('click', (e) => {
      e.stopPropagation();
      openNoteModal(note);
    });

    card.querySelector('.btn-delete-note').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteNote(note.id);
    });

    board.appendChild(card);
  });
}

function setupDrawingCanvas() {
  canvasElem = document.getElementById('note-canvas');
  if (!canvasElem) return;

  canvasCtx = canvasElem.getContext('2d');
  canvasCtx.lineCap = 'round';
  canvasCtx.lineJoin = 'round';

  const colorPicker = document.getElementById('draw-color-picker');
  const widthPicker = document.getElementById('draw-line-width');
  const btnClear = document.getElementById('btn-clear-canvas');

  if (colorPicker) {
    colorPicker.addEventListener('change', () => {
      if (canvasCtx) canvasCtx.strokeStyle = colorPicker.value;
    });
  }

  if (widthPicker) {
    widthPicker.addEventListener('change', () => {
      if (canvasCtx) canvasCtx.lineWidth = widthPicker.value;
    });
  }

  if (btnClear) {
    btnClear.addEventListener('click', () => {
      if (canvasCtx && canvasElem) {
        canvasCtx.clearRect(0, 0, canvasElem.width, canvasElem.height);
      }
    });
  }

  // Pointer/Touch/Mouse Drawing listeners
  const startDraw = (e) => {
    isDrawing = true;
    const rect = canvasElem.getBoundingClientRect();
    const x = (e.clientX || e.touches?.[0]?.clientX) - rect.left;
    const y = (e.clientY || e.touches?.[0]?.clientY) - rect.top;

    canvasCtx.beginPath();
    canvasCtx.moveTo(x, y);
    if (colorPicker) canvasCtx.strokeStyle = colorPicker.value;
    if (widthPicker) canvasCtx.lineWidth = widthPicker.value;
  };

  const draw = (e) => {
    if (!isDrawing) return;
    e.preventDefault();
    const rect = canvasElem.getBoundingClientRect();
    const x = (e.clientX || e.touches?.[0]?.clientX) - rect.left;
    const y = (e.clientY || e.touches?.[0]?.clientY) - rect.top;

    canvasCtx.lineTo(x, y);
    canvasCtx.stroke();
  };

  const stopDraw = () => {
    if (isDrawing) {
      canvasCtx.closePath();
      isDrawing = false;
    }
  };

  canvasElem.addEventListener('mousedown', startDraw);
  canvasElem.addEventListener('mousemove', draw);
  canvasElem.addEventListener('mouseup', stopDraw);
  canvasElem.addEventListener('mouseleave', stopDraw);

  canvasElem.addEventListener('touchstart', startDraw);
  canvasElem.addEventListener('touchmove', draw);
  canvasElem.addEventListener('touchend', stopDraw);
}

function setupModalEvents() {
  const modal = document.getElementById('note-modal');
  const btnClose = document.getElementById('btn-close-modal');
  const btnSave = document.getElementById('btn-save-note');
  const fileInput = document.getElementById('note-image-input');
  const btnRemoveImg = document.getElementById('btn-remove-note-img');

  if (btnClose && modal) {
    btnClose.addEventListener('click', () => modal.classList.remove('open'));
  }

  // Color Swatches
  const colorSwatches = document.querySelectorAll('.color-swatch');
  colorSwatches.forEach((swatch) => {
    swatch.addEventListener('click', () => {
      colorSwatches.forEach((s) => s.classList.remove('active'));
      swatch.classList.add('active');
      selectedColor = swatch.getAttribute('data-color') || '#fef08a';
    });
  });

  // Image input
  if (fileInput) {
    fileInput.addEventListener('change', () => {
      if (fileInput.files && fileInput.files[0]) {
        const file = fileInput.files[0];
        const nameDisplay = document.getElementById('note-image-name');
        if (nameDisplay) nameDisplay.textContent = file.name;

        const reader = new FileReader();
        reader.onload = (e) => {
          uploadedImageBase64 = e.target.result;
          showModalImagePreview(uploadedImageBase64);

          uploadToCloudinary(uploadedImageBase64).then((cloudUrl) => {
            if (cloudUrl) uploadedImageUrl = cloudUrl;
          });
        };
        reader.readAsDataURL(file);
      }
    });
  }

  if (btnRemoveImg) {
    btnRemoveImg.addEventListener('click', () => {
      uploadedImageUrl = null;
      uploadedImageBase64 = null;
      if (fileInput) fileInput.value = '';
      const previewBox = document.getElementById('note-image-preview-box');
      if (previewBox) previewBox.style.display = 'none';
      const nameDisplay = document.getElementById('note-image-name');
      if (nameDisplay) nameDisplay.textContent = 'Sin imagen';
      btnRemoveImg.style.display = 'none';
    });
  }

  const btnAddChecklistItem = document.getElementById('btn-add-checklist-item');
  const checklistInput = document.getElementById('checklist-item-input');

  if (btnAddChecklistItem && checklistInput) {
    const addCurrentChecklistItem = () => {
      const text = checklistInput.value.trim();
      if (text) {
        modalChecklistItems.push({ text: text, completed: false });
        checklistInput.value = '';
        renderModalChecklistItems();
      }
    };

    btnAddChecklistItem.addEventListener('click', addCurrentChecklistItem);
    checklistInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addCurrentChecklistItem();
      }
    });
  }

  if (btnSave) {
    btnSave.addEventListener('click', handleSaveNote);
  }

  // View Note Modal Listeners
  const viewModal = document.getElementById('note-view-modal');
  const btnCloseView = document.getElementById('btn-close-view-modal');
  const btnCloseViewBottom = document.getElementById('btn-close-view-modal-bottom');
  const btnEditFromView = document.getElementById('btn-edit-from-view');

  const closeViewModal = () => {
    if (viewModal) viewModal.classList.remove('open');
    activeViewingNote = null;
  };

  if (btnCloseView) btnCloseView.addEventListener('click', closeViewModal);
  if (btnCloseViewBottom) btnCloseViewBottom.addEventListener('click', closeViewModal);

  if (viewModal) {
    viewModal.addEventListener('click', (e) => {
      if (e.target === viewModal) closeViewModal();
    });
  }

  if (btnEditFromView) {
    btnEditFromView.addEventListener('click', () => {
      const noteToEdit = activeViewingNote;
      closeViewModal();
      if (noteToEdit) {
        openNoteModal(noteToEdit);
      }
    });
  }
}

function renderModalChecklistItems() {
  const listElem = document.getElementById('checklist-items-list');
  if (!listElem) return;

  listElem.innerHTML = '';
  modalChecklistItems.forEach((item, idx) => {
    const row = document.createElement('div');
    row.className = 'checklist-item-row';
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '8px';
    row.style.marginTop = '6px';

    row.innerHTML = `
      <input type="checkbox" ${item.completed ? 'checked' : ''} class="postit-card-checkbox">
      <span class="checklist-item-text ${item.completed ? 'completed' : ''}" style="flex:1; font-family:'Caveat', cursive; font-size:1.2rem;">${escapeHtml(item.text)}</span>
      <button type="button" class="btn-delete-item btn-tool" style="padding: 2px 8px; font-size: 0.85rem;">✕</button>
    `;

    row.querySelector('input[type="checkbox"]').addEventListener('change', (e) => {
      modalChecklistItems[idx].completed = e.target.checked;
      renderModalChecklistItems();
    });

    row.querySelector('.btn-delete-item').addEventListener('click', () => {
      modalChecklistItems.splice(idx, 1);
      renderModalChecklistItems();
    });

    listElem.appendChild(row);
  });
}

function openNoteViewModal(note) {
  const viewModal = document.getElementById('note-view-modal');
  const viewCard = document.getElementById('note-view-card');
  const viewTitle = document.getElementById('view-note-title');
  const viewContent = document.getElementById('view-note-content');
  const viewDrawingBox = document.getElementById('view-note-drawing-box');
  const viewDrawing = document.getElementById('view-note-drawing');
  const viewImageBox = document.getElementById('view-note-image-box');
  const viewImage = document.getElementById('view-note-image');

  if (!viewModal) return;

  activeViewingNote = note;

  if (viewCard) {
    viewCard.style.backgroundColor = note.color || '#fef08a';
  }

  if (viewTitle) viewTitle.textContent = note.title || '';
  if (viewContent) {
    let contentHtml = '';
    if (note.content) {
      contentHtml += `<p style="margin-bottom: 12px;">${escapeHtml(note.content)}</p>`;
    }
    if (Array.isArray(note.items) && note.items.length > 0) {
      contentHtml += `<div class="postit-checklist">` +
        note.items.map((it, idx) => `
          <label class="postit-checklist-item ${it.completed ? 'completed' : ''}" style="font-size: 1.35rem; margin-bottom: 6px;">
            <input type="checkbox" class="view-modal-checkbox" ${it.completed ? 'checked' : ''} data-item-idx="${idx}">
            <span>${escapeHtml(it.text)}</span>
          </label>
        `).join('') +
        `</div>`;
    }
    viewContent.innerHTML = contentHtml;
    viewContent.style.display = (note.content || (Array.isArray(note.items) && note.items.length > 0)) ? 'block' : 'none';

    viewContent.querySelectorAll('.view-modal-checkbox').forEach((cb) => {
      cb.addEventListener('change', (e) => {
        const itemIdx = parseInt(cb.getAttribute('data-item-idx'));
        if (Array.isArray(note.items) && note.items[itemIdx] !== undefined) {
          note.items[itemIdx].completed = cb.checked;
          saveLocalNotes();
          syncUpdateNoteToSupabase(note);
          openNoteViewModal(note);
        }
      });
    });
  }

  if (viewDrawingBox && viewDrawing) {
    if (note.drawingData) {
      viewDrawing.src = note.drawingData;
      viewDrawingBox.style.display = 'block';
    } else {
      viewDrawingBox.style.display = 'none';
    }
  }

  if (viewImageBox && viewImage) {
    if (note.imageUrl) {
      viewImage.src = note.imageUrl;
      viewImageBox.style.display = 'block';
    } else {
      viewImageBox.style.display = 'none';
    }
  }

  viewModal.classList.add('open');
}

function showModalImagePreview(src) {
  const previewBox = document.getElementById('note-image-preview-box');
  const previewImg = document.getElementById('note-image-preview');
  const btnRemove = document.getElementById('btn-remove-note-img');

  if (previewBox && previewImg) {
    previewImg.src = src;
    previewBox.style.display = 'block';
  }
  if (btnRemove) btnRemove.style.display = 'inline-block';
}

function openNoteModal(noteToEdit = null) {
  const modal = document.getElementById('note-modal');
  const modalTitle = document.getElementById('modal-title');
  const titleInput = document.getElementById('note-title-input');
  const contentInput = document.getElementById('note-content-input');
  const sizeSelect = document.getElementById('note-size-select');
  const fileInput = document.getElementById('note-image-input');
  const nameDisplay = document.getElementById('note-image-name');

  // Clear previous canvas
  if (canvasCtx && canvasElem) {
    canvasCtx.clearRect(0, 0, canvasElem.width, canvasElem.height);
  }

  uploadedImageUrl = null;
  uploadedImageBase64 = null;
  if (fileInput) fileInput.value = '';
  if (nameDisplay) nameDisplay.textContent = 'Sin imagen';

  const previewBox = document.getElementById('note-image-preview-box');
  if (previewBox) previewBox.style.display = 'none';

  if (noteToEdit) {
    editingNoteId = noteToEdit.id;
    if (modalTitle) modalTitle.textContent = 'Editar Nota Post-it';
    if (titleInput) titleInput.value = noteToEdit.title || '';
    if (contentInput) contentInput.value = noteToEdit.content || '';
    modalChecklistItems = Array.isArray(noteToEdit.items) ? JSON.parse(JSON.stringify(noteToEdit.items)) : [];

    selectedColor = noteToEdit.color || '#fef08a';
    document.querySelectorAll('.color-swatch').forEach((s) => {
      s.classList.toggle('active', s.getAttribute('data-color') === selectedColor);
    });

    if (sizeSelect) {
      sizeSelect.value = `${noteToEdit.width || 260}x${noteToEdit.height || 260}`;
    }

    if (noteToEdit.imageUrl) {
      uploadedImageUrl = noteToEdit.imageUrl;
      showModalImagePreview(noteToEdit.imageUrl);
    }

    if (noteToEdit.drawingData && canvasCtx) {
      const img = new Image();
      img.onload = () => {
        canvasCtx.drawImage(img, 0, 0);
      };
      img.src = noteToEdit.drawingData;
    }

  } else {
    editingNoteId = null;
    if (modalTitle) modalTitle.textContent = 'Nueva Nota Post-it';
    if (titleInput) titleInput.value = '';
    if (contentInput) contentInput.value = '';
    modalChecklistItems = [];
    selectedColor = '#fef08a';
    document.querySelectorAll('.color-swatch').forEach((s) => {
      s.classList.toggle('active', s.getAttribute('data-color') === '#fef08a');
    });
  }

  renderModalChecklistItems();

  if (modal) modal.classList.add('open');
}

async function handleSaveNote() {
  const titleInput = document.getElementById('note-title-input');
  const contentInput = document.getElementById('note-content-input');
  const sizeSelect = document.getElementById('note-size-select');

  const title = titleInput.value.trim();
  const content = contentInput.value.trim();

  if (!title) {
    alert('Por favor especifica un nombre para la nota.');
    return;
  }

  let width = 260;
  let height = 260;
  if (sizeSelect && sizeSelect.value) {
    const parts = sizeSelect.value.split('x');
    width = parseInt(parts[0]) || 260;
    height = parseInt(parts[1]) || 260;
  }

  // Check if canvas has drawing content
  let drawingData = null;
  if (canvasElem) {
    const pixelBuffer = new Uint32Array(
      canvasCtx.getImageData(0, 0, canvasElem.width, canvasElem.height).data.buffer
    );
    const hasDrawing = pixelBuffer.some((color) => color !== 0);
    if (hasDrawing) {
      drawingData = canvasElem.toDataURL('image/png');
    }
  }

  const finalImageUrl = uploadedImageUrl || uploadedImageBase64 || null;

  if (editingNoteId) {
    const idx = notes.findIndex((n) => n.id === editingNoteId);
    if (idx !== -1) {
      notes[idx].title = title;
      notes[idx].content = content;
      notes[idx].items = modalChecklistItems;
      notes[idx].color = selectedColor;
      notes[idx].width = width;
      notes[idx].height = height;
      if (finalImageUrl) notes[idx].imageUrl = finalImageUrl;
      if (drawingData) notes[idx].drawingData = drawingData;

      syncUpdateNoteToSupabase(notes[idx]);
    }
  } else {
    const newNote = {
      id: 'note_' + Date.now(),
      title: title,
      content: content,
      items: modalChecklistItems,
      color: selectedColor,
      imageUrl: finalImageUrl,
      drawingData: drawingData,
      width: width,
      height: height,
      createdAt: new Date().toISOString()
    };
    notes.push(newNote);
    syncCreateNoteToSupabase(newNote);
  }

  saveLocalNotes();

  const modal = document.getElementById('note-modal');
  if (modal) modal.classList.remove('open');

  showToast('Nota post-it guardada con éxito');
}

async function syncCreateNoteToSupabase(note) {
  try {
    const { data, error } = await supabase.from('notes').insert([{
      title: note.title,
      content: note.content,
      items: note.items || [],
      color: note.color,
      image_url: note.imageUrl,
      drawing_data: note.drawingData,
      width: note.width,
      height: note.height
    }]).select();

    if (!error && data && data[0]) {
      note.db_id = data[0].id;
      saveLocalNotes();
    }
  } catch (e) {
    console.warn('Could not sync created note to Supabase:', e);
  }
}

async function syncUpdateNoteToSupabase(note) {
  try {
    if (note.db_id) {
      await supabase.from('notes').update({
        title: note.title,
        content: note.content,
        items: note.items || [],
        color: note.color,
        image_url: note.imageUrl,
        drawing_data: note.drawingData,
        width: note.width,
        height: note.height
      }).eq('id', note.db_id);
    } else {
      await supabase.from('notes').update({
        content: note.content,
        items: note.items || [],
        color: note.color,
        image_url: note.imageUrl,
        drawing_data: note.drawingData
      }).eq('title', note.title);
    }
  } catch (e) {
    console.warn('Could not sync updated note to Supabase:', e);
  }
}

async function deleteNote(id) {
  if (!confirm('¿Estás seguro de eliminar esta nota?')) return;
  const target = notes.find((n) => n.id === id);
  notes = notes.filter((n) => n.id !== id);
  saveLocalNotes();

  showToast('Nota eliminada');

  if (target) {
    try {
      if (target.db_id) {
        await supabase.from('notes').delete().eq('id', target.db_id);
      } else {
        await supabase.from('notes').delete().eq('title', target.title);
      }
    } catch (e) {
      console.warn('Could not sync deleted note to Supabase:', e);
    }
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
