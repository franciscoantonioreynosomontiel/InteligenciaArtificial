// ====================================================================
// SUPABASE EDGE FUNCTION PARA GEMINI AI (gemini-chat/index.ts)
// ====================================================================
// Esta funcion es el nucleo inteligente del asistente virtual Sara.
// Gestiona peticiones a Google Gemini v1beta, herramientas (Function Calling),
// historial conversacional multi-turno, analisis multimodal de imagenes
// y estructuracion de datos para almacenamiento en Supabase.
// ====================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

// Limpieza estricta de textos devueltos por la IA
function cleanAIResponseText(text: string): string {
  if (!text) return '';
  let cleaned = text;

  // 1. Eliminar bloques de pensamiento o razonamiento interno
  cleaned = cleaned.replace(/<(thought|think)[\s\S]*?<\/\1>/gi, '');
  cleaned = cleaned.replace(/(pensamiento|thought|reasoning|proceso de pensamiento):[\s\S]*?(?=\n\n|\n[A-Z¡¿"']|$)/gi, '');

  // 2. Eliminar metadatos en ingles o viñetas de depuracion
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

  cleaned = filteredLines.join('\n').trim();

  // 3. Eliminar caracteres excesivos de formato markdown manteniéndolo legible
  cleaned = cleaned.replace(/[*_~`#]/g, '').trim();

  return cleaned;
}

// Declaraciones formales de herramientas (Function Calling) para Gemini
const TOOL_DECLARATIONS = [
  {
    functionDeclarations: [
      {
        name: "crear_alarma",
        description: "Crea y programa una nueva alarma en el sistema para una hora y fecha especifica.",
        parameters: {
          type: "OBJECT",
          properties: {
            nombre: { type: "STRING", description: "Titulo o identificador de la alarma" },
            hora: { type: "STRING", description: "Hora exacta en formato 24h (HH:MM)" },
            fecha: { type: "STRING", description: "Fecha opcional en formato YYYY-MM-DD" },
            mensaje: { type: "STRING", description: "Mensaje hablado que la IA dira cuando suene la alarma" }
          },
          required: ["nombre", "hora"]
        }
      },
      {
        name: "crear_recordatorio",
        description: "Crea y guarda un recordatorio para el usuario Sara.",
        parameters: {
          type: "OBJECT",
          properties: {
            nombre: { type: "STRING", description: "Asunto o titulo del recordatorio" },
            hora: { type: "STRING", description: "Hora de ejecucion (HH:MM)" },
            fecha: { type: "STRING", description: "Fecha de ejecucion (YYYY-MM-DD)" },
            mensaje: { type: "STRING", description: "Mensaje descriptivo que la IA hablara" }
          },
          required: ["nombre", "hora"]
        }
      },
      {
        name: "eliminar_alarma",
        description: "Elimina una alarma o recordatorio existente buscando por su nombre.",
        parameters: {
          type: "OBJECT",
          properties: {
            nombre: { type: "STRING", description: "Nombre de la alarma o recordatorio a borrar" }
          },
          required: ["nombre"]
        }
      },
      {
        name: "consultar_alarmas",
        description: "Consulta y lista todas las alarmas y recordatorios actualmente activos o guardados.",
        parameters: {
          type: "OBJECT",
          properties: {}
        }
      },
      {
        name: "crear_conocimiento_faq",
        description: "Guarda una nueva entrada de conocimiento o FAQ en aprender.html.",
        parameters: {
          type: "OBJECT",
          properties: {
            titulo: { type: "STRING", description: "Titulo del conocimiento o pregunta FAQ" },
            contenido: { type: "STRING", description: "Explicacion, respuesta o contenido detallado" }
          },
          required: ["titulo", "contenido"]
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
    const { prompt, message, history, image, image_url, knowledge_context } = body;
    const userPrompt = (prompt || message || 'Hola').trim();

    // Obtencion de la API Key de Google Gemini desde Secrets de Supabase
    const apiKey = (
      Deno.env.get('GEMINI_API_KEY') ||
      Deno.env.get('OPENAI_API_KEY') ||
      ''
    ).trim();

    if (!apiKey) {
      return new Response(
        JSON.stringify({
          reply: 'Error: No se encontró la clave de API de Gemini en los Secrets de Supabase (GEMINI_API_KEY). Configúrala en el panel de Supabase -> Project Settings -> Edge Functions -> Secrets.'
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Lista jerarquica de modelos Gemini a probar prioritariamente
    const availableModels = [
      'gemini-2.0-flash',
      'gemini-1.5-flash',
      'gemini-1.5-pro'
    ];

    // Construccion de la conversacion multi-turno
    const contents: Array<{ role: string; parts: Array<any> }> = [];

    if (Array.isArray(history) && history.length > 0) {
      for (const turn of history) {
        if (turn && turn.role && turn.content) {
          contents.push({
            role: turn.role === 'user' ? 'user' : 'model',
            parts: [{ text: String(turn.content) }]
          });
        }
      }
    }

    // Parte actual con imagen multimodal si existe
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

    // Contexto del sistema e instrucciones principales
    const systemInstruction = {
      parts: [
        {
          text: `Eres Sara, una Inteligencia Artificial sumamente potente, sabia, brillante, alegre y servicial. Tienes dominio total y profundo en matemáticas, física, programación, ciencias, cocina, modelado 3D, desarrollo web, desplegar repositorios y conversación general.

REGLAS OBLIGATORIAS:
1. Responde SIEMPRE de forma directa, completa, inteligente y exacta a la pregunta o consulta realizada por el usuario.
2. Si el usuario te hace una pregunta matemática (por ejemplo "1 mas 1"), responde el resultado matemático directo con su explicación breve o exacta.
3. Si te pide explicaciones de recetas, guías paso a paso o tutoriales (por ejemplo un pastel de 3 leches o importar GLB a Blender), entrega la receta completa o los pasos exactos explicados punto por punto.
4. NUNCA respondas con frases plantilla como "Con mucho gusto te ayudo, ¿qué aspecto quieres profundizar?". RESPONDE LA PREGUNTA DE UNA VEZ DE FORMA COMPLETA.
5. Si el usuario te pide crear una alarma, recordatorio o guardar un conocimiento, usa la herramienta adecuada de function calling o especifica la acción.
6. Habla en español de forma fluida, clara y agradable. PROHIBIDO incluir reflexiones internas, etiquetas de pensamiento o notas en inglés.

${knowledge_context ? `[Base de Conocimiento Actualizada]:\n${knowledge_context}` : ''}`
        }
      ]
    };

    let geminiRes: Response | null = null;
    let aiData: any = null;
    let lastApiError: string = '';

    // Intento recursivo sobre los modelos disponibles de Gemini
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
          console.warn(`Error llamando a ${modelName}:`, data.error.message);
        }
      } catch (e: any) {
        lastApiError = `[${modelName}] ${e.message}`;
        console.warn(`Excepcion con ${modelName}:`, e);
      }
    }

    if (!geminiRes || !aiData) {
      return new Response(
        JSON.stringify({
          reply: `No se pudo obtener respuesta de Google Gemini. Verifica la API Key en los Secrets de Supabase. Detalle: ${lastApiError}`
        }),
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

    const cleanReply = cleanAIResponseText(rawReply);

    return new Response(
      JSON.stringify({
        reply: cleanReply,
        toolCalls: toolCalls.length > 0 ? toolCalls : null
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    return new Response(
      JSON.stringify({ reply: 'Error interno en la Edge Function: ' + error.message }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
