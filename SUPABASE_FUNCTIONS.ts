// ====================================================================
// SUPABASE EDGE FUNCTION PARA GEMINI AI (gemini-chat/index.ts)
// ====================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function cleanAIResponseText(text: string): string {
  if (!text) return '';
  let cleaned = text;

  // 1. Remove thinking blocks if present (e.g., <thought>...</thought> or <think>...</think>)
  cleaned = cleaned.replace(/<(thought|think)[\s\S]*?<\/\1>/gi, '');

  // 2. Remove "Pensamiento: ...", "Thought: ...", "Reasoning: ..." prefixes or multiline blocks
  cleaned = cleaned.replace(/(pensamiento|thought|reasoning|proceso de pensamiento):[\s\S]*?(?=\n\n|\n[A-Z¡¿"']|$)/gi, '');

  // 3. Remove meta-headers and bullet thought lists
  const lines = cleaned.split('\n');
  const filteredLines = lines.filter(line => {
    const trimmed = line.trim();
    if (trimmed.startsWith('*') && (
      trimmed.toLowerCase().includes('user input') ||
      trimmed.toLowerCase().includes('persona') ||
      trimmed.toLowerCase().includes('constraint') ||
      trimmed.toLowerCase().includes('thought') ||
      trimmed.toLowerCase().includes('direct answer') ||
      trimmed.toLowerCase().includes('reasoning') ||
      trimmed.toLowerCase().includes('pensamiento') ||
      trimmed.toLowerCase().includes('spanish')
    )) {
      return false;
    }
    return true;
  });

  cleaned = filteredLines.join(' ').trim();

  // 4. Remove leftover markdown quotes and formatting symbols
  cleaned = cleaned.replace(/[*_~`#"]/g, '').trim();

  // 5. Deduplicate identical sentences
  const sentences = cleaned.split(/(?<=[.!?¡¿])\s+/).map(s => s.trim()).filter(Boolean);
  const uniqueSentences: string[] = [];
  for (const sentence of sentences) {
    if (!uniqueSentences.includes(sentence)) {
      uniqueSentences.push(sentence);
    }
  }

  return uniqueSentences.join(' ').trim() || cleaned;
}

const TOOL_DECLARATIONS = [
  {
    functionDeclarations: [
      {
        name: "crear_alarma",
        description: "Crea o programa una nueva alarma para el usuario.",
        parameters: {
          type: "OBJECT",
          properties: {
            nombre: { type: "STRING", description: "Nombre o titulo de la alarma" },
            hora: { type: "STRING", description: "Hora de la alarma en formato HH:MM (24 horas)" },
            fecha: { type: "STRING", description: "Fecha en formato YYYY-MM-DD si aplica" },
            mensaje: { type: "STRING", description: "Mensaje que hablara la IA al sonar la alarma" }
          },
          required: ["nombre", "hora"]
        }
      },
      {
        name: "crear_recordatorio",
        description: "Crea o programa un nuevo recordatorio para el usuario.",
        parameters: {
          type: "OBJECT",
          properties: {
            nombre: { type: "STRING", description: "Nombre o asunto del recordatorio" },
            hora: { type: "STRING", description: "Hora en formato HH:MM (24 horas)" },
            fecha: { type: "STRING", description: "Fecha en formato YYYY-MM-DD" },
            mensaje: { type: "STRING", description: "Mensaje que la IA dira como recordatorio" }
          },
          required: ["nombre", "hora"]
        }
      },
      {
        name: "eliminar_alarma",
        description: "Elimina una alarma o recordatorio programado.",
        parameters: {
          type: "OBJECT",
          properties: {
            nombre: { type: "STRING", description: "Nombre de la alarma o recordatorio a eliminar" }
          },
          required: ["nombre"]
        }
      },
      {
        name: "consultar_alarmas",
        description: "Consulta las alarmas y recordatorios actualmente programados.",
        parameters: {
          type: "OBJECT",
          properties: {}
        }
      }
    ]
  }
];

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { prompt, message, history, image, image_url } = body;
    const userPrompt = prompt || message || 'Hola';

    const apiKey = (Deno.env.get('GEMINI_API_KEY') || Deno.env.get('OPENAI_API_KEY') || '').trim();

    if (!apiKey) {
      return new Response(
        JSON.stringify({ reply: 'Error: No se encontró la API Key de Gemini en los Secrets (GEMINI_API_KEY o OPENAI_API_KEY).' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Direct model selection (flash 2.0 first, then 1.5 flash, then 1.5 pro)
    const availableModels = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'];

    // 2. Preparar el contenido (historial conversacional + texto e imagen base64 si aplica)
    const contents: Array<{ role: string; parts: Array<any> }> = [];

    if (Array.isArray(history) && history.length > 0) {
      for (const turn of history) {
        if (turn.role && turn.content) {
          contents.push({
            role: turn.role === 'user' ? 'user' : 'model',
            parts: [{ text: turn.content }]
          });
        }
      }
    }

    const currentParts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];

    const rawImageData = image || image_url;
    if (rawImageData && typeof rawImageData === 'string' && rawImageData.includes('base64,')) {
      const mimeType = rawImageData.substring(rawImageData.indexOf(':') + 1, rawImageData.indexOf(';'));
      const base64Data = rawImageData.split(',')[1];
      currentParts.push({
        inlineData: {
          mimeType: mimeType || 'image/jpeg',
          data: base64Data
        }
      });
    }

    currentParts.push({ text: userPrompt });
    contents.push({ role: 'user', parts: currentParts });

    const systemInstruction = {
      parts: [
        {
          text: "Eres una Inteligencia Artificial sumamente inteligente, sabia, alegre, amable, entusiasta y servicial creada para interactuar con el usuario Sara. Posees conocimientos completos y profundos sobre programacion, ciencia, tecnologia, matematicas, cultura, conversacion general y gestion de tareas.\n\nReglas estrictas e inviolables:\n1. Responde a CUALQUIER pregunta, duda o tema que el usuario plantee de forma clara, natural, inteligente y alegre en espanol. NUNCA respondas con frases estaticas o predefinidas.\n2. Mantén conversaciones fluidas y contextuales de forma dinamica e inteligente.\n3. Si el usuario te pide crear, eliminar o consultar alarmas o recordatorios, invoca la herramienta correspondiente (crear_alarma, crear_recordatorio, eliminar_alarma, consultar_alarmas) o indica la accion para que el sistema la registre en aprender.html y en la base de datos.\n4. PROHIBIDO incluir pensamientos internos, etiquetas <thought>, procesos de razonamiento ni notas en ingles."
        }
      ]
    };

    // 3. Probar con los modelos
    let geminiRes: Response | null = null;
    let aiData: any = null;
    let lastApiError: string = '';

    for (const modelName of availableModels) {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

      const generationConfig: Record<string, any> = {
        temperature: 0.7,
        maxOutputTokens: 2048
      };

      if (modelName.includes('2.0')) {
        generationConfig.thinkingConfig = { thinkingBudget: 0 };
      }

      try {
        const res = await fetch(geminiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction,
            contents,
            tools: TOOL_DECLARATIONS,
            generationConfig
          })
        });

        const data = await res.json();
        if (res.ok && data.candidates && data.candidates.length > 0) {
          geminiRes = res;
          aiData = data;
          break;
        } else if (data.error && data.error.message) {
          lastApiError = `[${modelName}] ${data.error.message}`;
          console.warn(`Error en modelo ${modelName}:`, data.error.message);
        }
      } catch (e: any) {
        lastApiError = `[${modelName}] ${e.message}`;
        console.warn(`Exception llamando a modelo ${modelName}:`, e);
      }
    }

    if (!geminiRes || !aiData) {
      const detailedErr = lastApiError ? ` Detalles: ${lastApiError}` : '';
      return new Response(
        JSON.stringify({ reply: `Error al comunicarse con la IA de Google Gemini. Verifica tu API Key y permisos de modelo.${detailedErr}` }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const candidate = aiData.candidates?.[0];
    const resParts = candidate?.content?.parts || [];
    let rawReply = '';
    let toolCalls: any[] = [];

    for (const part of resParts) {
      if (part.text) rawReply += part.text;
      if (part.functionCall) {
        toolCalls.push(part.functionCall);
      }
    }

    // Clean and sanitize response text
    let cleanReply = cleanAIResponseText(rawReply);

    return new Response(
      JSON.stringify({
        reply: cleanReply,
        toolCalls: toolCalls.length > 0 ? toolCalls : null
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    return new Response(
      JSON.stringify({ reply: 'Error interno: ' + error.message }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
