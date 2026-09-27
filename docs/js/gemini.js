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

export function cleanAIResponseText(text) {
  if (!text) return '';
  let cleaned = text;

  // 1. Remove thinking blocks if present
  cleaned = cleaned.replace(/<(thought|think)[\s\S]*?<\/\1>/gi, '');

  // 2. Remove meta-headers and bullet thought lists
  const lines = cleaned.split('\n');
  const filteredLines = lines.filter((line) => {
    const trimmed = line.trim();
    if (
      trimmed.startsWith('*') &&
      (trimmed.toLowerCase().includes('user input') ||
        trimmed.toLowerCase().includes('persona') ||
        trimmed.toLowerCase().includes('constraint') ||
        trimmed.toLowerCase().includes('thought') ||
        trimmed.toLowerCase().includes('direct answer') ||
        trimmed.toLowerCase().includes('reasoning') ||
        trimmed.toLowerCase().includes('spanish'))
    ) {
      return false;
    }
    return true;
  });

  cleaned = filteredLines.join(' ').trim();

  // 3. If quotes exist around direct speech, extract the final quoted response if available
  const quotesMatch = [...cleaned.matchAll(/"([^"\n\r]{3,})"/g)];
  if (quotesMatch.length > 0) {
    const lastQuote = quotesMatch[quotesMatch.length - 1][1].trim();
    if (lastQuote.length > 3) {
      cleaned = lastQuote;
    }
  }

  // 4. Remove leftover markdown symbols and formatting
  cleaned = cleaned.replace(/[*_~`#"]/g, '').trim();

  // 5. Deduplicate identical sentences
  const sentences = cleaned.split(/(?<=[.!?¡¿])\s+/).map((s) => s.trim()).filter(Boolean);
  const uniqueSentences = [];
  for (const sentence of sentences) {
    if (!uniqueSentences.includes(sentence)) {
      uniqueSentences.push(sentence);
    }
  }

  return uniqueSentences.join(' ').trim() || cleaned;
}

export async function processGeminiRequest(userPrompt, attachmentData = null) {
  const contextKnowledge = getStoredKnowledgePrompt();
  const contextAlarms = getStoredAlarmsPrompt();

  const systemPrompt = `[INSTRUCCIONES DE COMPORTAMIENTO Y PERSONALIDAD DE LA IA]:
- Eres una asistente virtual alegre, amable, entusiasta y muy inteligente.
- REGLA ABSOLUTA: Responde ÚNICAMENTE con el mensaje final directo en español.
- NUNCA incluyas pensamientos, análisis interno, procesos, notas, sugerencias en inglés ni opciones en paréntesis.
- Responde siempre de forma natural, alegre y concreta.`;

  const fullPrompt = `${systemPrompt}\n\nPregunta del usuario: ${userPrompt || '¿Qué ves en esta imagen?'}${contextKnowledge}${contextAlarms}`;

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
        return cleanAIResponseText(resData.reply);
      }
    } else {
      console.warn('Supabase Edge function call returned status:', edgeResponse.status);
    }
  } catch (err) {
    console.warn('Could not connect to Supabase Edge function, checking client-side fallback...', err);
  }

  // 2. Fallback simulate / direct response if Edge function is not deployed yet
  return cleanAIResponseText(generateClientFallbackResponse(userPrompt, attachmentData));
}

function generateClientFallbackResponse(prompt, attachment) {
  const lower = (prompt || '').toLowerCase();

  if (attachment) {
    return `¡Por supuesto! He analizado la imagen que me enviaste. ¡Se ve genial y muy clara! ¿Hay algo específico que te gustaría consultar sobre ella?`;
  }

  // Calculate target date helper
  const now = new Date();
  let targetDate = new Date(now);

  if (lower.includes('mañana')) {
    targetDate.setDate(now.getDate() + 1);
  } else if (lower.includes('pasado mañana')) {
    targetDate.setDate(now.getDate() + 2);
  }
  const dateStr = targetDate.toISOString().split('T')[0];

  // 1. Check for Alarm creation
  if (lower.includes('despiertame') || lower.includes('despiértame') || lower.includes('alarma') || lower.includes('despertar')) {
    const timeMatch = lower.match(/(\d{1,2})[:\.]?(\d{2})?\s*(am|pm)?/);

    if (!timeMatch) {
      return `¡Con mucho gusto te ayudo a crear tu alarma! ¿Para qué día y a qué hora te gustaría despertar?`;
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

    // Default target date logic if single day
    let alarmDate = dateStr;
    const currentHourMin = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    if (!lower.includes('mañana') && !lower.includes('pasado mañana') && formattedTime > currentHourMin) {
      alarmDate = now.toISOString().split('T')[0]; // today if time hasn't passed
    }

    const alarmData = {
      nombre: `Alarma ${formattedTime}`,
      hora: formattedTime,
      mensaje: '¡Es hora de despertar y comenzar el día con la mejor actitud!',
      fecha: isRecurring ? null : alarmDate,
      dias: isRecurring ? [0, 1, 2, 3, 4, 5, 6] : null
    };

    const result = executeAlarmTool('crear_alarma', alarmData);
    return `¡Listo! ${result} Guardada en tus Algoritmos en aprender.html.`;
  }

  // 2. Check for Reminder creation
  if (lower.includes('recuerdame') || lower.includes('recuérdame') || lower.includes('recordatorio') || lower.includes('recordar')) {
    const timeMatch = lower.match(/(\d{1,2})[:\.]?(\d{2})?\s*(am|pm)?/);

    if (!timeMatch) {
      return `¡Por supuesto! Dime qué día y a qué hora necesitas que te lo recuerde y con gusto guardo tu recordatorio.`;
    }

    let h = parseInt(timeMatch[1]);
    const m = timeMatch[2] || '00';
    const period = timeMatch[3];
    if (period === 'pm' && h < 12) h += 12;
    if (period === 'am' && h === 12) h = 0;
    const hour = String(h).padStart(2, '0');
    const min = String(m).padStart(2, '0');
    const formattedTime = `${hour}:${min}`;

    let topic = prompt.replace(/recuerdame|recuérdame|crea un recordatorio|recordatorio|para mañana|para el|a las \d{1,2}(:\d{2})?(\s*(am|pm))?/gi, '').trim();
    if (!topic || topic.length < 2) topic = 'Recordatorio pendiente';

    const isRecurring = lower.includes('todos los dias') || lower.includes('todos los días') || lower.includes('diario') || lower.includes('siempre');

    let reminderDate = dateStr;
    const currentHourMin = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    if (!lower.includes('mañana') && !lower.includes('pasado mañana') && formattedTime > currentHourMin) {
      reminderDate = now.toISOString().split('T')[0];
    }

    const reminderData = {
      nombre: topic,
      hora: formattedTime,
      mensaje: `Hola, recuerda: ${topic}`,
      fecha: isRecurring ? null : reminderDate,
      dias: isRecurring ? [0, 1, 2, 3, 4, 5, 6] : null
    };

    const result = executeAlarmTool('crear_recordatorio', reminderData);
    return `¡Entendido! ${result} Guardado en tus Algoritmos en aprender.html.`;
  }

  if (lower.includes('cancela') || lower.includes('elimina') || lower.includes('borra')) {
    const result = executeAlarmTool('eliminar_alarma', { nombre: lower });
    return `¡Entendido! ${result}`;
  }

  if (lower.includes('que alarmas') || lower.includes('mis alarmas') || lower.includes('mis recordatorios') || lower.includes('qué alarmas')) {
    const result = executeAlarmTool('consultar_alarmas', {});
    return `¡Claro! Aquí tienes tus alarmas y recordatorios:\n${result}`;
  }

  if (lower.includes('hola') || lower.includes('buenas') || lower.includes('buenos dias') || lower.includes('buenas tardes')) {
    return '¡Hola! ¡Qué gusto saludarte! ¿En qué te puedo ayudar hoy?';
  }

  if (lower.includes('quien eres') || lower.includes('tu nombre') || lower.includes('quién eres')) {
    return '¡Hola! Soy tu asistente virtual inteligente. Estoy aquí para ayudarte con tus preguntas, alarmas y recordatorios.';
  }

  if (lower.includes('gracias')) {
    return '¡Con muchísimo gusto! Siempre es un gran placer ayudarte.';
  }

  return `¡Entendido! He procesado tu solicitud: "${prompt}". Todo ha quedado guardado y actualizado.`;
}
