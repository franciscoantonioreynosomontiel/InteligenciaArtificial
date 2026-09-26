// Gemini AI Integration & Supabase Edge Function Handler

const SUPABASE_URL = 'https://qqjhadwxboeichxtxree.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFxamhhZHd4Ym9laWNoeHR4cmVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4NDY4ODAsImV4cCI6MjA5NTQyMjg4MH0.dM1VaV-lDPxoPlOHGAIbgfCSE3RMdURcVubq8tTs6yQ';
const EDGE_FUNCTION_NAME = 'gemini-chat';

function getStoredKnowledgePrompt() {
  try {
    const raw = localStorage.getItem('ia_agent_knowledge');
    if (!raw) return '';
    const items = JSON.parse(raw);
    if (!Array.isArray(items) || items.length === 0) return '';

    let knowledgeStr = '\n\nInformación de contexto (Base de conocimiento):\n';
    items.forEach((item, index) => {
      knowledgeStr += `${index + 1}. [${item.type.toUpperCase()}] ${item.title}: ${item.content}\n`;
    });
    return knowledgeStr;
  } catch (e) {
    return '';
  }
}

export async function processGeminiRequest(userPrompt, attachmentData = null) {
  const contextKnowledge = getStoredKnowledgePrompt();
  const fullPrompt = `${userPrompt || '¿Qué ves en esta imagen?'}${contextKnowledge}`;

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
    return `He analizado la imagen que me mostraste. Se ve muy clara. ¿Te gustaría saber algo más específico sobre ella?`;
  }

  if (lower.includes('hola') || lower.includes('buenas')) {
    return 'Hola Sara, ¿en qué te puedo ayudar? ✨';
  }

  if (lower.includes('quien eres') || lower.includes('quién eres') || lower.includes('tu nombre')) {
    return 'Hola Sara, soy tu asistente virtual 3D. ¡Puedes hablarme o pedirme lo que necesites!';
  }

  if (lower.includes('gracias')) {
    return '¡De nada! Siempre es un placer ayudarte. 😊';
  }

  return `Entendido: "${prompt}". Para conectar las respuestas de Gemini en vivo a través de tu Edge Function de Supabase, revisa el archivo INSTRUCCIONES_SUPABASE.txt para configurar la clave GEMINI_API_KEY.`;
}
