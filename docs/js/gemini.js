// Gemini AI Integration & Client Dispatcher
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://qqjhadwxboeichxtxree.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFxamhhZHd4Ym9laWNoeHR4cmVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4NDY4ODAsImV4cCI6MjA5NTQyMjg4MH0.dM1VaV-lDPxoPlOHGAIbgfCSE3RMdURcVubq8tTs6yQ';
const EDGE_FUNCTION_NAME = 'gemini-chat';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const ALARMS_STORAGE_KEY = 'ia_agent_alarms_reminders';
const KNOWLEDGE_STORAGE_KEY = 'ia_agent_knowledge';
const NOTES_STORAGE_KEY = 'ia_agent_notes';
const CONTACTS_STORAGE_KEY = 'ia_agent_contacts';

// Conversational memory for multi-turn chats
let chatHistory = [];

export function getChatHistory() {
  return chatHistory;
}

export function clearChatHistory() {
  chatHistory = [];
}

function getStoredKnowledgePrompt() {
  try {
    const raw = localStorage.getItem(KNOWLEDGE_STORAGE_KEY);
    if (!raw) return '';
    const items = JSON.parse(raw);
    if (!Array.isArray(items) || items.length === 0) return '';

    let knowledgeStr = '\n\nInformacion de contexto (Base de conocimiento):\n';
    items.forEach((item, index) => {
      knowledgeStr += `${index + 1}. [${item.type.toUpperCase()}] ${item.title}: ${item.content}\n`;
    });
    return knowledgeStr;
  } catch (e) {
    return '';
  }
}

function getStoredNotesPrompt() {
  try {
    const raw = localStorage.getItem(NOTES_STORAGE_KEY);
    if (!raw) return '';
    const items = JSON.parse(raw);
    if (!Array.isArray(items) || items.length === 0) return '';

    let noteStr = '\n\nNotas y Listas Post-it guardadas:\n';
    items.forEach((item, index) => {
      let itemsListStr = '';
      if (Array.isArray(item.items) && item.items.length > 0) {
        itemsListStr = ' | Elementos checklist: ' + item.items.map(i => `[${i.completed ? '✓ COMPLETO' : '  PENDIENTE'}] ${i.text}`).join(', ');
      }
      noteStr += `${index + 1}. Titulo: "${item.title}" | Contenido: "${item.content || ''}"${itemsListStr} | Color: ${item.color || '#fef08a'}\n`;
    });
    return noteStr;
  } catch (e) {
    return '';
  }
}

function getStoredAlarmsPrompt() {
  try {
    const raw = localStorage.getItem(ALARMS_STORAGE_KEY);
    if (!raw) return '';
    const items = JSON.parse(raw);
    if (!Array.isArray(items) || items.length === 0) return '';

    let alarmStr = '\n\nAlarmas y Recordatorios configurados actualmente:\n';
    items.forEach((item, index) => {
      const schedule = item.scheduleMode === 'days'
        ? `Dias: [${(item.days || []).join(',')}] a las ${item.time}`
        : `Fecha: ${item.date} a las ${item.time}`;
      const status = item.active ? 'ACTIVA' : 'INACTIVA';
      alarmStr += `${index + 1}. ID: ${item.id} | Tipo: ${item.type.toUpperCase()} | Nombre: "${item.name}" | ${schedule} | Estado: ${status} | Mensaje: "${item.message}"\n`;
    });
    return alarmStr;
  } catch (e) {
    return '';
  }
}

async function syncAlarmToSupabase(item) {
  try {
    const { data, error } = await supabase.from('alarms_reminders').insert([{
      type: item.type,
      name: item.name,
      message: item.message,
      schedule_mode: item.scheduleMode,
      days: item.days,
      specific_date: item.date,
      time: item.time,
      timezone: item.timezone || 'local',
      use_range: item.useRange || false,
      range_start: item.rangeStart || null,
      range_end: item.rangeEnd || null,
      range_limit: item.rangeLimit || 1,
      voice: item.voice || 'default',
      sound: item.sound || 'Predeterminado',
      sound_url: item.soundUrl || null,
      volume: item.volume || 0.8,
      repeat: item.repeat !== undefined ? item.repeat : true,
      repeat_interval: item.repeatInterval || 5,
      max_repeats: item.maxRepeats || 3,
      interaction: item.interaction || 'button',
      active: item.active !== false
    }]).select();

    if (!error && data && data[0]) {
      item.db_id = data[0].id;
      const raw = localStorage.getItem(ALARMS_STORAGE_KEY);
      if (raw) {
        let items = JSON.parse(raw);
        const idx = items.findIndex((i) => i.id === item.id);
        if (idx !== -1) {
          items[idx].db_id = data[0].id;
          localStorage.setItem(ALARMS_STORAGE_KEY, JSON.stringify(items));
        }
      }
    }
  } catch (e) {
    console.warn('Could not sync created alarm/reminder to Supabase:', e);
  }
}

async function syncNoteToSupabase(item) {
  try {
    const { data, error } = await supabase.from('notes').insert([{
      title: item.title,
      content: item.content,
      items: item.items || [],
      color: item.color || '#fef08a',
      image_url: item.imageUrl || item.image_url || null,
      width: item.width || 260,
      height: item.height || 260
    }]).select();

    if (!error && data && data[0]) {
      item.db_id = data[0].id;
      const raw = localStorage.getItem(NOTES_STORAGE_KEY);
      if (raw) {
        let items = JSON.parse(raw);
        const idx = items.findIndex((i) => i.id === item.id);
        if (idx !== -1) {
          items[idx].db_id = data[0].id;
          localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(items));
        }
      }
    }
  } catch (e) {
    console.warn('Could not sync note to Supabase:', e);
  }
}

async function syncUpdateNoteToSupabase(item) {
  try {
    if (item.db_id) {
      await supabase.from('notes').update({
        title: item.title,
        content: item.content,
        items: item.items || [],
        color: item.color || '#fef08a',
        image_url: item.imageUrl || item.image_url || null
      }).eq('id', item.db_id);
    } else {
      await supabase.from('notes').update({
        content: item.content,
        items: item.items || [],
        color: item.color || '#fef08a',
        image_url: item.imageUrl || item.image_url || null
      }).ilike('title', item.title);
    }
  } catch (e) {
    console.warn('Could not sync updated note to Supabase:', e);
  }
}

async function syncDeleteNoteFromSupabase(query) {
  try {
    await supabase.from('notes').delete().ilike('title', `%${query}%`);
  } catch (e) {
    console.warn('Could not sync deleted note to Supabase:', e);
  }
}

async function syncKnowledgeToSupabase(item) {
  try {
    const { data, error } = await supabase.from('knowledge').insert([{
      type: item.type,
      title: item.title,
      content: item.content
    }]).select();

    if (!error && data && data[0]) {
      item.db_id = data[0].id;
      const raw = localStorage.getItem(KNOWLEDGE_STORAGE_KEY);
      if (raw) {
        let items = JSON.parse(raw);
        const idx = items.findIndex((i) => i.id === item.id);
        if (idx !== -1) {
          items[idx].db_id = data[0].id;
          localStorage.setItem(KNOWLEDGE_STORAGE_KEY, JSON.stringify(items));
        }
      }
    }
  } catch (e) {
    console.warn('Could not sync knowledge item to Supabase:', e);
  }
}

async function syncDeleteAlarmFromSupabase(query) {
  try {
    await supabase.from('alarms_reminders').delete().ilike('name', `%${query}%`);
  } catch (e) {
    console.warn('Could not sync deleted alarm/reminder to Supabase:', e);
  }
}

async function syncContactToSupabase(contact) {
  try {
    const { data, error } = await supabase.from('contacts').insert([{
      name: contact.name,
      phone: contact.phone
    }]).select();

    if (!error && data && data[0]) {
      contact.db_id = data[0].id;
    }
  } catch (e) {
    console.warn('Could not sync contact to Supabase:', e);
  }
}

export function getStoredContacts() {
  const raw = localStorage.getItem(CONTACTS_STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

export function saveContactLocally(name, phone) {
  let contacts = getStoredContacts();
  const newContact = {
    id: 'cnt_' + Date.now(),
    name: name.trim(),
    phone: phone.trim(),
    createdAt: new Date().toISOString()
  };
  contacts.push(newContact);
  localStorage.setItem(CONTACTS_STORAGE_KEY, JSON.stringify(contacts));
  syncContactToSupabase(newContact);
  return newContact;
}

export function downloadVCard(name, phone) {
  const vcardData = `BEGIN:VCARD\nVERSION:3.0\nFN:${name}\nTEL;TYPE=CELL:${phone}\nEND:VCARD`;
  const blob = new Blob([vcardData], { type: 'text/vcard;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name.replace(/\s+/g, '_')}.vcf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function parseNoteItems(itemsInput) {
  if (!itemsInput) return [];
  if (Array.isArray(itemsInput)) {
    return itemsInput.map((it) => {
      if (typeof it === 'object' && it !== null && it.text) {
        return { text: String(it.text).trim(), completed: Boolean(it.completed) };
      }
      return { text: String(it).trim(), completed: false };
    }).filter((it) => it.text.length > 0);
  }
  if (typeof itemsInput === 'string') {
    return itemsInput
      .split(/,|\n|;/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => ({ text: s, completed: false }));
  }
  return [];
}

function parseItemsFromContent(contentStr) {
  if (!contentStr || typeof contentStr !== 'string') return [];
  if (contentStr.includes(',') || contentStr.includes('\n')) {
    return contentStr
      .split(/,|\n|;/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => ({ text: s, completed: false }));
  }
  return [];
}

// Tool Execution Dispatcher for Alarms, Reminders, Knowledge, Locations, and Contacts
export async function executeAlarmToolAsync(toolName, args) {
  if (toolName === 'llamar_contacto') {
    return executeCallContact(args.nombre);
  }
  if (toolName === 'guardar_contacto') {
    return executeSaveContact(args.nombre, args.telefono);
  }
  if (toolName === 'reproducir_musica') {
    if (!window.location.pathname.endsWith('musica.html')) {
      setTimeout(() => {
        window.location.href = './musica.html';
      }, 1200);
    }
    return '¡Claro! Abriendo el reproductor de música...';
  }
  return executeAlarmTool(toolName, args);
}

export function executeCallContact(name) {
  if (!name) return 'No especificaste a quién llamar.';

  const contacts = getStoredContacts();
  const searchName = name.toLowerCase().trim();
  const found = contacts.find((c) => c.name.toLowerCase().includes(searchName));

  if (found && found.phone) {
    window.location.href = `tel:${found.phone}`;
    return `Abriendo la aplicación de teléfono para llamar a ${found.name} al número ${found.phone}.`;
  }

  if ('contacts' in navigator && 'ContactsManager' in window) {
    navigator.contacts.select(['name', 'tel'], { multiple: false }).then((results) => {
      if (results && results.length > 0 && results[0].tel && results[0].tel.length > 0) {
        const phone = results[0].tel[0];
        window.location.href = `tel:${phone}`;
      }
    }).catch((e) => console.warn('Contacts select error:', e));
    return `Buscando a "${name}" en los contactos de tu dispositivo...`;
  }

  return `No encontré el número de teléfono guardado para "${name}". Puedes pedirme "guarda a ${name} con el número X" para registrarlo.`;
}

export function executeSaveContact(name, phone) {
  if (!name || !phone) return 'Se requiere el nombre y número de teléfono para guardar un contacto.';
  saveContactLocally(name, phone);
  downloadVCard(name, phone);
  return `Contacto "${name}" con número ${phone} guardado exitosamente. Se ha descargado la tarjeta para agregarlo a los contactos de tu dispositivo.`;
}

export function executeAlarmTool(toolName, args) {
  const raw = localStorage.getItem(ALARMS_STORAGE_KEY);
  let items = raw ? JSON.parse(raw) : [];

  switch (toolName) {
    case 'crear_alarma': {
      const now = new Date();
      const defaultDate = now.toISOString().split('T')[0];
      const newAlarm = {
        id: 'alg_' + Date.now(),
        type: 'alarma',
        category: 'algorithm',
        title: args.nombre || 'Alarma',
        name: args.nombre || 'Alarma',
        message: args.mensaje || args.nombre || 'Es hora de despertar',
        scheduleMode: args.fecha ? 'date' : (args.dias ? 'days' : 'date'),
        days: Array.isArray(args.dias) ? args.dias : [0, 1, 2, 3, 4, 5, 6],
        date: args.fecha || defaultDate,
        time: args.hora || '07:00',
        timezone: args.zona_horaria || 'local',
        useRange: false,
        voice: args.voz || 'default',
        sound: args.sonido || 'Predeterminado',
        volume: 0.8,
        repeat: args.repeticion !== undefined ? Boolean(args.repeticion) : true,
        repeatInterval: args.intervalo || 5,
        maxRepeats: args.max_repeticiones || 3,
        interaction: args.interaccion || 'button',
        active: true,
        lastExecuted: null,
        createdAt: new Date().toISOString()
      };
      items.push(newAlarm);
      localStorage.setItem(ALARMS_STORAGE_KEY, JSON.stringify(items));
      syncAlarmToSupabase(newAlarm);
      return `Alarma "${newAlarm.name}" configurada exitosamente para las ${newAlarm.time}.`;
    }

    case 'crear_recordatorio': {
      const now = new Date();
      const defaultDate = now.toISOString().split('T')[0];
      const newReminder = {
        id: 'alg_' + Date.now(),
        type: 'recordatorio',
        category: 'algorithm',
        title: args.nombre || 'Recordatorio',
        name: args.nombre || 'Recordatorio',
        message: args.mensaje || args.nombre || 'Tienes un recordatorio pendiente',
        scheduleMode: args.fecha ? 'date' : (args.dias ? 'days' : 'date'),
        days: Array.isArray(args.dias) ? args.dias : [0, 1, 2, 3, 4, 5, 6],
        date: args.fecha || defaultDate,
        time: args.hora || '08:00',
        timezone: args.zona_horaria || 'local',
        useRange: Boolean(args.rango_inicio && args.rango_fin),
        rangeStart: args.rango_inicio || null,
        rangeEnd: args.rango_fin || null,
        rangeLimit: args.limite_rango || 1,
        voice: args.voz || 'default',
        sound: args.sonido || 'Predeterminado',
        volume: 0.8,
        repeat: false,
        active: true,
        lastExecuted: null,
        executionCountInRange: 0,
        createdAt: new Date().toISOString()
      };
      items.push(newReminder);
      localStorage.setItem(ALARMS_STORAGE_KEY, JSON.stringify(items));
      syncAlarmToSupabase(newReminder);
      return `Recordatorio "${newReminder.name}" guardado exitosamente para las ${newReminder.time}.`;
    }

    case 'editar_alarma':
    case 'editar_recordatorio': {
      const searchName = (args.nombre_buscar || '').toLowerCase().trim();
      const target = items.find((i) => i.name.toLowerCase().includes(searchName) || searchName.includes(i.name.toLowerCase()));
      if (!target) {
        return `No se encontró ningún ${toolName === 'editar_alarma' ? 'alarma' : 'recordatorio'} que coincida con "${args.nombre_buscar}".`;
      }
      if (args.nuevo_nombre) {
        target.name = args.nuevo_nombre.trim();
        target.title = args.nuevo_nombre.trim();
      }
      if (args.nueva_hora) target.time = args.nueva_hora.trim();
      if (args.nueva_fecha) target.date = args.nueva_fecha.trim();
      if (args.nuevo_mensaje) target.message = args.nuevo_mensaje.trim();
      if (args.nuevos_dias && Array.isArray(args.nuevos_dias)) target.days = args.nuevos_dias;
      if (args.activo !== undefined) target.active = Boolean(args.activo);

      localStorage.setItem(ALARMS_STORAGE_KEY, JSON.stringify(items));
      if (target.db_id) {
        supabase.from('alarms_reminders').update({
          name: target.name,
          time: target.time,
          specific_date: target.date,
          days: target.days,
          message: target.message,
          active: target.active
        }).eq('id', target.db_id).then(() => {});
      }
      return `${target.type === 'alarma' ? 'Alarma' : 'Recordatorio'} "${target.name}" actualizado exitosamente para las ${target.time}.`;
    }

    case 'crear_conocimiento_faq': {
      const kRaw = localStorage.getItem(KNOWLEDGE_STORAGE_KEY);
      let kItems = kRaw ? JSON.parse(kRaw) : [];
      const newFaq = {
        id: 'faq_' + Date.now(),
        type: 'faq',
        title: args.titulo || 'Informacion',
        content: args.contenido || '',
        createdAt: new Date().toISOString()
      };
      kItems.push(newFaq);
      localStorage.setItem(KNOWLEDGE_STORAGE_KEY, JSON.stringify(kItems));
      syncKnowledgeToSupabase(newFaq);
      return `Conocimiento "${newFaq.title}" guardado en aprender.html.`;
    }

    case 'crear_nota': {
      const nRaw = localStorage.getItem(NOTES_STORAGE_KEY);
      let nItems = nRaw ? JSON.parse(nRaw) : [];
      const title = (args.titulo || 'Nueva Nota').trim();
      const existingIdx = nItems.findIndex((n) => n.title.toLowerCase().trim() === title.toLowerCase());

      const parsedItems = parseNoteItems(args.items || (args.contenido ? parseItemsFromContent(args.contenido) : []));

      if (existingIdx !== -1) {
        const target = nItems[existingIdx];
        if (args.contenido) target.content = args.contenido;
        if (args.color) target.color = args.color;
        if (args.image_url || args.imageUrl) target.imageUrl = args.image_url || args.imageUrl;

        if (parsedItems.length > 0) {
          if (!Array.isArray(target.items)) target.items = [];
          parsedItems.forEach((newIt) => {
            if (!target.items.some((existingIt) => existingIt.text.toLowerCase() === newIt.text.toLowerCase())) {
              target.items.push(newIt);
            }
          });
        }
        localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(nItems));
        syncUpdateNoteToSupabase(target);
        return `Nota post-it "${target.title}" actualizada exitosamente.`;
      }

      const newNote = {
        id: 'note_' + Date.now(),
        title: title,
        content: args.contenido || '',
        items: parsedItems,
        color: args.color || '#fef08a',
        imageUrl: args.image_url || args.imageUrl || null,
        width: 260,
        height: 260,
        createdAt: new Date().toISOString()
      };
      nItems.push(newNote);
      localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(nItems));
      syncNoteToSupabase(newNote);
      return `Nota post-it "${newNote.title}" guardada exitosamente en notas.html.`;
    }

    case 'editar_nota': {
      const nRaw = localStorage.getItem(NOTES_STORAGE_KEY);
      let nItems = nRaw ? JSON.parse(nRaw) : [];
      const searchTitle = (args.titulo_buscar || '').toLowerCase().trim();

      const target = nItems.find((n) => n.title.toLowerCase().includes(searchTitle) || searchTitle.includes(n.title.toLowerCase()));
      if (!target) {
        return `No se encontró ninguna nota que coincida con "${args.titulo_buscar}".`;
      }

      if (args.nuevo_titulo) target.title = args.nuevo_titulo.trim();
      if (args.nuevo_contenido) target.content = args.nuevo_contenido.trim();
      if (args.nuevo_color) target.color = args.nuevo_color;

      const newItems = parseNoteItems(args.agregar_items || args.items);
      if (newItems.length > 0) {
        if (!Array.isArray(target.items)) target.items = [];
        newItems.forEach((it) => {
          const matchIdx = target.items.findIndex((ex) => ex.text.toLowerCase() === it.text.toLowerCase());
          if (matchIdx !== -1) {
            target.items[matchIdx] = it;
          } else {
            target.items.push(it);
          }
        });
      }

      localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(nItems));
      syncUpdateNoteToSupabase(target);
      return `Nota post-it "${target.title}" actualizada exitosamente.`;
    }

    case 'eliminar_nota': {
      const nRaw = localStorage.getItem(NOTES_STORAGE_KEY);
      let nItems = nRaw ? JSON.parse(nRaw) : [];
      const query = (args.titulo || '').toLowerCase().trim();

      const initialCount = nItems.length;
      nItems = nItems.filter((n) => !n.title.toLowerCase().includes(query) && !query.includes(n.title.toLowerCase()));

      if (nItems.length < initialCount) {
        localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(nItems));
        syncDeleteNoteFromSupabase(query);
        return `La nota post-it se eliminó correctamente.`;
      }
      return `No se encontró ninguna nota con el nombre "${args.titulo}".`;
    }

    case 'marcar_item_nota': {
      const nRaw = localStorage.getItem(NOTES_STORAGE_KEY);
      let nItems = nRaw ? JSON.parse(nRaw) : [];
      const noteTitle = (args.titulo_nota || '').toLowerCase().trim();

      let target = nItems.find((n) => n.title.toLowerCase().includes(noteTitle) || noteTitle.includes(n.title.toLowerCase()));
      if (!target && nItems.length > 0) {
        target = nItems[nItems.length - 1];
      }

      if (!target) {
        return 'No se encontró ninguna nota para marcar los elementos.';
      }

      if (!Array.isArray(target.items)) target.items = [];

      const targetItemsToMark = parseNoteItems(args.items);
      const isCompleted = args.completado !== false;
      const markedNames = [];

      targetItemsToMark.forEach((t) => {
        const itemIdx = target.items.findIndex((i) => i.text.toLowerCase().includes(t.text.toLowerCase()) || t.text.toLowerCase().includes(i.text.toLowerCase()));
        if (itemIdx !== -1) {
          target.items[itemIdx].completed = isCompleted;
          markedNames.push(target.items[itemIdx].text);
        } else {
          target.items.push({ text: t.text, completed: isCompleted });
          markedNames.push(t.text);
        }
      });

      localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(nItems));
      syncUpdateNoteToSupabase(target);

      const statusWord = isCompleted ? 'marcado(s) como comprado(s)' : 'desmarcado(s)';
      return `Elemento(s) ${markedNames.join(', ')} ${statusWord} en la nota "${target.title}".`;
    }

    case 'consultar_notas': {
      const nRaw = localStorage.getItem(NOTES_STORAGE_KEY);
      const nItems = nRaw ? JSON.parse(nRaw) : [];
      if (nItems.length === 0) return 'No tienes notas guardadas actualmente.';

      let result = 'Notas guardadas:\n';
      nItems.forEach((n) => {
        result += `- "${n.title}"`;
        if (Array.isArray(n.items) && n.items.length > 0) {
          const pending = n.items.filter((i) => !i.completed).map((i) => i.text);
          const completed = n.items.filter((i) => i.completed).map((i) => i.text);
          result += ` (Pendientes: ${pending.length > 0 ? pending.join(', ') : 'Ninguno'} | Comprados: ${completed.length > 0 ? completed.join(', ') : 'Ninguno'})`;
        } else if (n.content) {
          result += `: ${n.content}`;
        }
        result += '\n';
      });
      return result;
    }

    case 'eliminar_alarma':
    case 'eliminar_recordatorio': {
      const query = (args.nombre || args.id || '').toLowerCase();
      const initialCount = items.length;
      items = items.filter((item) => item.id !== args.id && !item.name.toLowerCase().includes(query));
      localStorage.setItem(ALARMS_STORAGE_KEY, JSON.stringify(items));
      if (items.length < initialCount) {
        syncDeleteAlarmFromSupabase(query);
        return `Se elimino la regla/alarma especificada.`;
      }
      return `No se encontro la alarma o recordatorio "${query}".`;
    }

    case 'consultar_alarmas':
    case 'consultar_recordatorios': {
      if (items.length === 0) return 'No tienes alarmas ni recordatorios programados.';
      return items.map((i) => `- ${i.type.toUpperCase()}: ${i.name} a las ${i.time} (${i.active ? 'Activa' : 'Inactiva'})`).join('\n');
    }

    default:
      return 'Acción procesada correctamente.';
  }
}

export async function formulateAIReminderMessage(referenceText) {
  const prompt = `Formula un recordatorio o aviso muy breve, amigable y natural basado en este tema o idea: "${referenceText}". No repitas las instrucciones literalmente, habla de forma humana y cercana.`;
  try {
    const res = await processGeminiRequest(prompt);
    if (res && res.length > 5) return res;
  } catch (e) {}
  return `Es hora de recordar: ${referenceText}.`;
}

export function cleanAIResponseText(text) {
  if (!text) return '';
  let cleaned = text;

  // 1. Remove thinking blocks
  cleaned = cleaned.replace(/<(thought|think)[\s\S]*?<\/\1>/gi, '');

  // 2. Remove draft breakdown / question decomposition blocks
  cleaned = cleaned.replace(/(question \d+:|knowledge areas:|steps \(|self-correction|drafting:|persona:|constraint:|\"como se hace|\"how to make)[\s\S]*?(?=\n\n[A-Z¡¿"']|Para |El |Hola |¡Hola |$)/gi, '');

  // 3. Remove "Pensamiento: ...", "Thought: ...", "Reasoning: ..." prefixes
  cleaned = cleaned.replace(/(pensamiento|thought|reasoning|proceso de pensamiento):[\s\S]*?(?=\n\n|\n[A-Z¡¿"']|$)/gi, '');

  // 4. Remove meta-headers
  const lines = cleaned.split('\n');
  const filteredLines = lines.filter((line) => {
    const trimmed = line.trim();
    const lower = trimmed.toLowerCase();
    if (
      trimmed.startsWith('*') &&
      (lower.includes('user input') ||
        lower.includes('persona') ||
        lower.includes('constraint') ||
        lower.includes('thought') ||
        lower.includes('direct answer') ||
        lower.includes('reasoning') ||
        lower.includes('pensamiento') ||
        lower.includes('spanish') ||
        lower.includes('knowledge areas') ||
        lower.includes('step-by-step instructions') ||
        lower.includes('sponge') ||
        lower.includes('tres leches'))
    ) {
      return false;
    }
    return true;
  });

  cleaned = filteredLines.join('\n').trim();

  // 5. Remove leftover markdown quotes and formatting
  cleaned = cleaned.replace(/[*_~`#]/g, '').trim();

  return cleaned;
}

export async function processGeminiRequest(userPrompt, attachmentData = null) {
  const contextKnowledge = getStoredKnowledgePrompt();
  const contextAlarms = getStoredAlarmsPrompt();
  const contextNotes = getStoredNotesPrompt();

  const now = new Date();
  const currentHourMin = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const currentDateStr = now.toISOString().split('T')[0];
  const timeContext = `Fecha y hora actual local del usuario: ${currentDateStr} ${currentHourMin}`;

  const fullPrompt = `${userPrompt || '¿Qué ves en esta imagen?'}${contextKnowledge}${contextAlarms}${contextNotes}`;

  if (userPrompt) {
    chatHistory.push({ role: 'user', content: userPrompt });
    if (chatHistory.length > 10) chatHistory = chatHistory.slice(-10);
  }

  const lowerUser = (userPrompt || '').toLowerCase();
  const isMusicIntent =
    lowerUser.includes('ponme musica') ||
    lowerUser.includes('quiero escuchar musica') ||
    lowerUser.includes('pon musica') ||
    lowerUser.includes('escuchar musica') ||
    lowerUser.includes('reproducir musica') ||
    lowerUser.includes('reproduce musica') ||
    lowerUser.includes('pon una cancion') ||
    lowerUser.includes('ponme una cancion');

  if (isMusicIntent && !window.location.pathname.endsWith('musica.html')) {
    setTimeout(() => {
      window.location.href = './musica.html';
    }, 1200);
  }

  let aiReplyText = '';

  // 1. Peticion a Supabase Edge Function
  try {
    const edgeUrl = `${SUPABASE_URL}/functions/v1/${EDGE_FUNCTION_NAME}`;
    const payload = {
      prompt: fullPrompt,
      history: chatHistory.slice(0, -1),
      knowledge_context: contextKnowledge,
      time_context: timeContext,
      image: attachmentData ? attachmentData.base64 : null
    };

    const edgeResponse = await fetch(edgeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify(payload)
    });

    if (edgeResponse.ok) {
      const resData = await edgeResponse.json();

      if (resData && Array.isArray(resData.toolCalls) && resData.toolCalls.length > 0) {
        let toolResultsStr = '';
        for (const toolCall of resData.toolCalls) {
          const fnName = toolCall.name;
          const fnArgs = toolCall.args || {};
          if (fnName === 'crear_nota' && attachmentData) {
            fnArgs.image_url = fnArgs.image_url || attachmentData.url || attachmentData.base64;
          }
          const toolRes = await executeAlarmToolAsync(fnName, fnArgs);
          toolResultsStr += ` ${toolRes}`;
        }
        aiReplyText = cleanAIResponseText((resData.reply || '') + toolResultsStr);
      } else if (resData && resData.reply && !resData.reply.startsWith('Error')) {
        aiReplyText = cleanAIResponseText(resData.reply);
      }
    }
  } catch (err) {
    console.warn('Conexion a Edge Function fallida, procesando dinamicamente en cliente...', err);
  }

  // 2. Procesamiento dinamico directo en cliente sin plantillas
  if (!aiReplyText) {
    aiReplyText = await executeDynamicClientAnswer(userPrompt, attachmentData);
  }

  if (aiReplyText) {
    chatHistory.push({ role: 'model', content: aiReplyText });
    if (chatHistory.length > 10) chatHistory = chatHistory.slice(-10);
  }

  return aiReplyText;
}

async function executeDynamicClientAnswer(prompt, attachment) {
  const lower = (prompt || '').toLowerCase().trim();

  if (attachment) {
    return 'He analizado la imagen proporcionada. Muestra un elemento visual que puedo examinar detalladamente. ¿Tienes alguna pregunta específica sobre su contenido o detalles?';
  }

  // Llamar a contacto por voz
  if (lower.startsWith('llama a') || lower.startsWith('llamar a') || lower.includes('llama a ') || lower.includes('llamar a ')) {
    const personName = prompt.replace(/llama a|llamar a|por favor/gi, '').trim();
    return executeCallContact(personName);
  }

  // Guardar número en contactos
  if (lower.includes('guarda') || lower.includes('guardame') || lower.includes('guárdame') || lower.includes('agrega')) {
    const phoneMatch = prompt.match(/(\+?\d[\d\s\-]{6,14}\d)/);
    if (phoneMatch) {
      const phone = phoneMatch[1].replace(/[\s\-]/g, '');
      let name = prompt.replace(/guarda|guardame|guárdame|este numero|este número|ponle de nombre|ponle|con el nombre|a|el numero|el número|\+?\d[\d\s\-]{6,14}\d/gi, '').trim();
      if (!name) name = 'Contacto';
      return executeSaveContact(name, phone);
    }
  }

  // Operaciones matemáticas directas
  const isMathExpr = lower.match(/^(\d+(\.\d+)?)\s*([\+\-\*\/]|mas|más|menos|por|entre)\s*(\d+(\.\d+)?)$/i);
  if (isMathExpr) {
    const num1 = parseFloat(isMathExpr[1]);
    const op = isMathExpr[3].toLowerCase();
    const num2 = parseFloat(isMathExpr[4]);
    let res = 0;
    if (op === '+' || op === 'mas' || op === 'más') res = num1 + num2;
    else if (op === '-' || op === 'menos') res = num1 - num2;
    else if (op === '*' || op === 'por') res = num1 * num2;
    else if (op === '/' || op === 'entre') res = num2 !== 0 ? num1 / num2 : 'indefinido (no se puede dividir por cero)';
    return `El resultado de ${num1} ${op} ${num2} es ${res}.`;
  }

  const now = new Date();
  let targetDate = new Date(now);

  if (lower.includes('mañana')) {
    targetDate.setDate(now.getDate() + 1);
  } else if (lower.includes('pasado mañana')) {
    targetDate.setDate(now.getDate() + 2);
  }
  const dateStr = targetDate.toISOString().split('T')[0];

  // Programar Alarma
  if (lower.includes('despiertame') || lower.includes('despiértame') || lower.includes('alarma') || lower.includes('despertar')) {
    const timeMatch = lower.match(/(\d{1,2})[:\.]?(\d{2})?\s*(am|pm)?/);

    if (!timeMatch) {
      return 'Por favor indícame la hora a la que deseas configurar tu alarma.';
    }

    let h = parseInt(timeMatch[1]);
    const m = timeMatch[2] || '00';
    const period = timeMatch[3];
    if (period === 'pm' && h < 12) h += 12;
    if (period === 'am' && h === 12) h = 0;
    const hour = String(h).padStart(2, '0');
    const min = String(m).padStart(2, '0');
    const formattedTime = `${hour}:${min}`;

    const isRecurring = lower.includes('todos los dias') || lower.includes('todos los días') || lower.includes('diario') || lower.includes('siempre');

    let alarmDate = dateStr;
    const currentHourMin = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    if (!lower.includes('mañana') && !lower.includes('pasado mañana') && formattedTime > currentHourMin) {
      alarmDate = now.toISOString().split('T')[0];
    }

    const alarmData = {
      nombre: `Alarma ${formattedTime}`,
      hora: formattedTime,
      mensaje: '¡Es hora de despertar y comenzar el día con energía!',
      fecha: isRecurring ? null : alarmDate,
      dias: isRecurring ? [0, 1, 2, 3, 4, 5, 6] : null
    };

    const result = executeAlarmTool('crear_alarma', alarmData);
    return `${result} Ha sido registrada en tu sección de Algoritmos en aprender.html.`;
  }

  // Marcar elementos comprados/completados
  if (lower.includes('ya compre') || lower.includes('ya compré') || lower.includes('marca ') || lower.includes('marcar ') || lower.includes('tacha ')) {
    const rawTarget = prompt.replace(/ya compre|ya compré|marca|marcar|tacha|por favor|en la lista|de la lista/gi, '').trim();
    if (rawTarget.length > 0) {
      const result = executeAlarmTool('marcar_item_nota', { items: rawTarget, completado: true });
      return result;
    }
  }

  // Consultar qué falta por comprar/completar
  if (lower.includes('que me falta') || lower.includes('qué me falta') || lower.includes('que falta') || lower.includes('qué falta')) {
    const nRaw = localStorage.getItem(NOTES_STORAGE_KEY);
    const nItems = nRaw ? JSON.parse(nRaw) : [];
    if (nItems.length === 0) return 'No tienes notas ni listas de compras guardadas.';

    const pendingItems = [];
    nItems.forEach((n) => {
      if (Array.isArray(n.items)) {
        n.items.filter((i) => !i.completed).forEach((i) => pendingItems.push(`${i.text} (de "${n.title}")`));
      }
    });

    if (pendingItems.length === 0) {
      return '¡Felicidades! Ya compraste y completaste todos los elementos de tus listas.';
    }
    return `Te falta por comprar/completar: ${pendingItems.join(', ')}.`;
  }

  // Crear o modificar Nota Post-it
  if (lower.includes('nota') || lower.includes('anota') || lower.includes('post-it') || lower.includes('postit') || lower.includes('agrega') || lower.includes('dentro pon')) {
    const nRaw = localStorage.getItem(NOTES_STORAGE_KEY);
    let nItems = nRaw ? JSON.parse(nRaw) : [];

    if (nItems.length > 0 && (lower.includes('agrega') || lower.includes('dentro') || lower.includes('pon lo siguiente') || lower.includes('actualiz') || lower.includes('modifica'))) {
      const itemsToAdd = prompt.replace(/ok dentro|dentro|pon lo siguiente|si puedes|con checkbox|para ir marcando lo que compre|agrega|pon|añade|en la nota/gi, '').trim();
      const lastNote = nItems[nItems.length - 1];
      const result = executeAlarmTool('editar_nota', {
        titulo_buscar: lastNote.title,
        agregar_items: itemsToAdd
      });
      return `${result} Puedes verla en notas.html.`;
    }

    let title = prompt.replace(/crea una nota|crear nota|haz una nota|anota|guarda una nota|post-it|postit|nota|con esta imagen|con esta foto|de esta imagen|de esta foto/gi, '').trim();

    const previousTurnWasPromptingName = chatHistory.length >= 2 &&
      chatHistory[chatHistory.length - 2].content.toLowerCase().includes('nombre') &&
      chatHistory[chatHistory.length - 2].content.toLowerCase().includes('nota');

    if (!title || title.length < 2) {
      if (!previousTurnWasPromptingName) {
        return '¿Con qué nombre te gustaría guardar tu nota?';
      } else {
        title = prompt.trim();
      }
    }

    const imgData = attachment ? (attachment.url || attachment.base64) : null;

    const noteData = {
      titulo: title,
      contenido: '',
      color: '#fef08a',
      image_url: imgData
    };

    const result = executeAlarmTool('crear_nota', noteData);
    return `${result} Puedes verla y editarla en la seccion de notas.html.`;
  }

  // Programar Recordatorio
  if (lower.includes('recuerda') || lower.includes('recuerdame') || lower.includes('recuérdame') || lower.includes('recordatorio') || lower.includes('recordar')) {
    let formattedTime = null;
    let reminderDate = dateStr;

    // Relative minutes e.g. "en 3 minutos", "en 10 min"
    const relMinMatch = lower.match(/en\s+(\d+)\s*minuto/);
    const relHourMatch = lower.match(/en\s+(\d+)\s*hora/);

    if (relMinMatch) {
      const mins = parseInt(relMinMatch[1]);
      const targetTime = new Date(now.getTime() + mins * 60 * 1000);
      const hour = String(targetTime.getHours()).padStart(2, '0');
      const min = String(targetTime.getMinutes()).padStart(2, '0');
      formattedTime = `${hour}:${min}`;
      reminderDate = targetTime.toISOString().split('T')[0];
    } else if (relHourMatch) {
      const hours = parseInt(relHourMatch[1]);
      const targetTime = new Date(now.getTime() + hours * 60 * 60 * 1000);
      const hour = String(targetTime.getHours()).padStart(2, '0');
      const min = String(targetTime.getMinutes()).padStart(2, '0');
      formattedTime = `${hour}:${min}`;
      reminderDate = targetTime.toISOString().split('T')[0];
    } else {
      const timeMatch = lower.match(/(\d{1,2})[:\.]?(\d{2})?\s*(am|pm)?/);
      if (timeMatch) {
        let h = parseInt(timeMatch[1]);
        const m = timeMatch[2] || '00';
        const period = timeMatch[3];
        if (period === 'pm' && h < 12) h += 12;
        if (period === 'am' && h === 12) h = 0;
        const hour = String(h).padStart(2, '0');
        const min = String(m).padStart(2, '0');
        formattedTime = `${hour}:${min}`;
        const currentHourMin = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        if (!lower.includes('mañana') && !lower.includes('pasado mañana') && formattedTime > currentHourMin) {
          reminderDate = now.toISOString().split('T')[0];
        }
      }
    }

    // Default to current/next hour time if no time specified
    if (!formattedTime) {
      const currentHour = String(now.getHours()).padStart(2, '0');
      const currentMin = String(now.getMinutes()).padStart(2, '0');
      formattedTime = `${currentHour}:${currentMin}`;
    }

    let topic = prompt.replace(/recuerdame|recuérdame|recuerda|crea un recordatorio|recordatorio|para mañana|para el|a las \d{1,2}(:\d{2})?(\s*(am|pm))?|en \d+ minutos?|en \d+ horas?/gi, '').trim();
    if (!topic || topic.length < 2 || topic.toLowerCase() === 'esto' || topic.toLowerCase() === 'cosa') {
      topic = 'Recordatorio pendiente';
    }

    const isRecurring = lower.includes('todos los dias') || lower.includes('todos los días') || lower.includes('diario') || lower.includes('siempre');

    const reminderData = {
      nombre: topic,
      hora: formattedTime,
      mensaje: `Recuerda: ${topic}`,
      fecha: isRecurring ? null : reminderDate,
      dias: isRecurring ? [0, 1, 2, 3, 4, 5, 6] : null
    };

    const result = executeAlarmTool('crear_recordatorio', reminderData);
    return `${result} Guardado para las ${formattedTime}. Puedes verlo en recordatorios.html. Si deseas ajustar la hora o fecha puedes decírmelo.`;
  }

  // Pastel de 3 leches
  if (lower.includes('pastel de 3 leches') || lower.includes('pastel de tres leches') || lower.includes('3 leches')) {
    return 'Para hacer un pastel de tres leches tradicional: 1) Bizcocho: Bate 5 huevos con 1 taza de azúcar hasta esponjar, añade 1 cucharadita de vainilla y envolventemente 1 taza de harina de trigo con 1.5 cucharaditas de polvo para hornear. Hornea a 180°C por 25-30 minutos. 2) Mezcla de leches: Mezcla 1 lata de leche condensada, 1 lata de leche evaporada y 1 taza de crema de leche. 3) Ensamble: Pica el bizcocho ya frío con un tenedor y viértela lentamente toda la mezcla de tres leches. Cubre con crema batida y espolvorea canela.';
  }

  // Importar GLB a Blender
  if (lower.includes('blender') || lower.includes('glb') || lower.includes('gltf')) {
    return 'Para importar un archivo GLB o GLTF en Blender: 1) Abre Blender y ve al menú superior Archivo (File) -> Importar (Import). 2) Selecciona la opción glTF 2.0 (.glb/.gltf). 3) Selecciona el archivo en tu computadora y haz clic en Importar. El modelo aparecerá inmediatamente en la vista 3D con todas sus texturas y materiales.';
  }

  // Desplegar Python en Render
  if (lower.includes('render') && lower.includes('python')) {
    return 'Para desplegar un proyecto Python en Render: 1) Sube tu código a GitHub. 2) En Render dashboard, haz clic en New Web Service y conecta tu repo. 3) En Build Command coloca "pip install -r requirements.txt". 4) En Start Command coloca "gunicorn app:app" o "python main.py". 5) Selecciona el plan gratuito y haz clic en Create Web Service.';
  }

  if (lower.includes('ponme musica') || lower.includes('quiero escuchar musica') || lower.includes('pon musica') || lower.includes('escuchar musica') || lower.includes('reproducir musica')) {
    if (!window.location.pathname.endsWith('musica.html')) {
      setTimeout(() => {
        window.location.href = './musica.html';
      }, 1200);
      return '¡Claro! Te llevo al reproductor de música.';
    }
  }

  if (lower.includes('hola') || lower.includes('buenas')) {
    return '¡Hola! Qué gusto saludarte. Estoy lista para responder tus preguntas, ayudarte con programación o configurar tus alarmas y recordatorios.';
  }

  if (lower.includes('gracias')) {
    return '¡Con mucho gusto! Estoy siempre disponible cuando lo necesites.';
  }

  return `Entendido. Tu consulta es "${prompt}". Puedes verificar que la API Key de Gemini esté configurada en los Secrets de Supabase para obtener respuestas con el modelo completo.`;
}
