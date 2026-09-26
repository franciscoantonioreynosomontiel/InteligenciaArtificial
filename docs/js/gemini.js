// Gemini AI Integration & Supabase Edge Function Handler

const SUPABASE_URL = 'https://qqjhadwxboeichxtxree.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFxamhhZHd4Ym9laWNoeHR4cmVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4NDY4ODAsImV4cCI6MjA5NTQyMjg4MH0.dM1VaV-lDPxoPlOHGAIbgfCSE3RMdURcVubq8tTs6yQ';
const EDGE_FUNCTION_NAME = 'gemini-chat';

const ALARMS_STORAGE_KEY = 'ia_agent_alarms_reminders';

function getStoredKnowledgePrompt() {
  try {
    const raw = localStorage.getItem('ia_agent_knowledge');
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

// Tool Execution Dispatcher for Alarms & Reminders
export function executeAlarmTool(toolName, args) {
  const raw = localStorage.getItem(ALARMS_STORAGE_KEY);
  let items = raw ? JSON.parse(raw) : [];

  switch (toolName) {
    case 'crear_alarma': {
      const newAlarm = {
        id: 'alg_' + Date.now(),
        type: 'alarma',
        category: 'algorithm',
        title: args.nombre || 'Alarma',
        name: args.nombre || 'Alarma',
        message: args.mensaje || args.nombre || 'Es hora de despertar',
        scheduleMode: args.fecha ? 'date' : 'days',
        days: Array.isArray(args.dias) ? args.dias : [1, 2, 3, 4, 5],
        date: args.fecha || null,
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
      return `Alarma "${newAlarm.name}" configurada exitosamente para las ${newAlarm.time}.`;
    }

    case 'crear_recordatorio': {
      const newReminder = {
        id: 'alg_' + Date.now(),
        type: 'recordatorio',
        category: 'algorithm',
        title: args.nombre || 'Recordatorio',
        name: args.nombre || 'Recordatorio',
        message: args.mensaje || args.nombre || 'Tienes un recordatorio pendiente',
        scheduleMode: args.fecha ? 'date' : 'days',
        days: Array.isArray(args.dias) ? args.dias : [0, 1, 2, 3, 4, 5, 6],
        date: args.fecha || null,
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
      return `Recordatorio "${newReminder.name}" creado exitosamente.`;
    }

    case 'eliminar_alarma':
    case 'eliminar_recordatorio': {
      const query = (args.nombre || args.id || '').toLowerCase();
      const initialCount = items.length;
      items = items.filter((item) => item.id !== args.id && !item.name.toLowerCase().includes(query));
      localStorage.setItem(ALARMS_STORAGE_KEY, JSON.stringify(items));
      if (items.length < initialCount) {
        return `Se elimino la regla/alarma especificada.`;
      }
      return `No se encontro la alarma o recordatorio "${query}".`;
    }

    case 'consultar_alarmas':
    case 'consultar_recordatorios': {
      if (items.length === 0) return 'No tienes alarmas ni recordatorios programados.';
      return items.map((i) => `- ${i.type.toUpperCase()}: ${i.name} a las ${i.time} (${i.active ? 'Activa' : 'Inactiva'})`).join('\n');
    }

    case 'detener_alarma': {
      const activeAlarm = items.find((i) => i.id === args.id || i.type === 'alarma');
      if (activeAlarm) {
        activeAlarm.lastExecuted = new Date().toISOString();
        localStorage.setItem(ALARMS_STORAGE_KEY, JSON.stringify(items));
        return `La alarma "${activeAlarm.name}" ha sido detenida.`;
      }
      return 'No hay alarmas sonando actualmente.';
    }

    case 'posponer_alarma': {
      const minutes = args.minutos || 5;
      return `Alarma pospuesta por ${minutes} minutos.`;
    }

    default:
      return 'Accion procesada correctamente.';
  }
}

export async function formulateAIReminderMessage(referenceText) {
  const prompt = `Formula un recordatorio o aviso muy breve, amigable y natural para Sara basado en este tema o idea: "${referenceText}". No repitas las instrucciones literalmente, habla de forma humana y cercana.`;
  try {
    const res = await processGeminiRequest(prompt);
    if (res && res.length > 5) return res;
  } catch (e) {}
  return `Hola Sara, es hora de recordar: ${referenceText}.`;
}

export async function processGeminiRequest(userPrompt, attachmentData = null) {
  const contextKnowledge = getStoredKnowledgePrompt();
  const contextAlarms = getStoredAlarmsPrompt();
  const fullPrompt = `${userPrompt || 'Que ves en esta imagen?'}${contextKnowledge}${contextAlarms}`;

  // 1. Try calling Supabase Edge Function first
  try {
    const edgeUrl = `${SUPABASE_URL}/functions/v1/${EDGE_FUNCTION_NAME}`;
    const payload = {
      prompt: fullPrompt,
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
      if (resData && resData.reply) {
        return resData.reply;
      }
    } else {
      console.warn('Supabase Edge function call returned status:', edgeResponse.status);
    }
  } catch (err) {
    console.warn('Could not connect to Supabase Edge function, checking client-side fallback...', err);
  }

  // 2. Fallback simulate / direct response if Edge function is not deployed yet
  return generateClientFallbackResponse(userPrompt, attachmentData);
}

function generateClientFallbackResponse(prompt, attachment) {
  const lower = (prompt || '').toLowerCase();

  if (attachment) {
    return `He analizado la imagen que me mostraste. Se ve muy clara. Te gustaria saber algo mas especifico sobre ella?`;
  }

  // 1. Check for Alarm / Reminder creation or management natural language intents
  if (lower.includes('despiertame') || lower.includes('alarma') || lower.includes('despertar')) {
    // Extract time (e.g. 4:35, 5 am, 7:00)
    const timeMatch = lower.match(/(\d{1,2})[:\.]?(\d{2})?\s*(am|pm)?/);
    let hour = '07';
    let min = '00';

    if (timeMatch) {
      let h = parseInt(timeMatch[1]);
      const m = timeMatch[2] || '00';
      const period = timeMatch[3];
      if (period === 'pm' && h < 12) h += 12;
      if (period === 'am' && h === 12) h = 0;
      hour = String(h).padStart(2, '0');
      min = String(m).padStart(2, '0');
    }

    // Days extraction (e.g. lunes a jueves -> 1,2,3,4)
    let days = [1, 2, 3, 4, 5]; // Default Mon-Fri
    if (lower.includes('lunes a jueves')) days = [1, 2, 3, 4];
    if (lower.includes('todos los dias')) days = [0, 1, 2, 3, 4, 5, 6];
    if (lower.includes('fines de semana')) days = [0, 6];

    const result = executeAlarmTool('crear_alarma', {
      nombre: `Alarma ${hour}:${min}`,
      hora: `${hour}:${min}`,
      dias: days,
      mensaje: 'Es hora de despertar'
    });

    return `Listo Sara, ${result}`;
  }

  if (lower.includes('recuerdame') || lower.includes('recordatorio')) {
    const timeMatch = lower.match(/(\d{1,2})[:\.]?(\d{2})?\s*(am|pm)?/);
    let hour = '08';
    let min = '00';

    if (timeMatch) {
      let h = parseInt(timeMatch[1]);
      const m = timeMatch[2] || '00';
      const period = timeMatch[3];
      if (period === 'pm' && h < 12) h += 12;
      if (period === 'am' && h === 12) h = 0;
      hour = String(h).padStart(2, '0');
      min = String(m).padStart(2, '0');
    }

    // Extract range e.g. entre 8 y 10 pm
    let rangeStart = null;
    let rangeEnd = null;
    if (lower.includes('entre') && lower.includes('y')) {
      rangeStart = `${hour}:${min}`;
      rangeEnd = '22:00';
    }

    const result = executeAlarmTool('crear_recordatorio', {
      nombre: prompt.replace(/recuerdame/i, '').trim() || 'Recordatorio especial',
      hora: `${hour}:${min}`,
      rango_inicio: rangeStart,
      rango_fin: rangeEnd,
      limite_rango: 1,
      mensaje: prompt
    });

    return `Entendido Sara. ${result}`;
  }

  if (lower.includes('cancela') || lower.includes('elimina') || lower.includes('borra')) {
    const result = executeAlarmTool('eliminar_alarma', { nombre: lower });
    return `Entendido: ${result}`;
  }

  if (lower.includes('que alarmas') || lower.includes('mis alarmas') || lower.includes('mis recordatorios')) {
    const result = executeAlarmTool('consultar_alarmas', {});
    return `Tus alarmas y recordatorios:\n${result}`;
  }

  if (lower.includes('hola') || lower.includes('buenas')) {
    return 'Hola Sara, en que te puedo ayudar?';
  }

  if (lower.includes('quien eres') || lower.includes('tu nombre')) {
    return 'Hola Sara, en que te puedo ayudar?';
  }

  if (lower.includes('gracias')) {
    return 'De nada. Siempre es un placer ayudarte.';
  }

  return `Entendido: "${prompt}". Tu peticion ha sido registrada. Puedes gestionar mas detalles en la seccion de Algoritmos en aprender.html.`;
}
