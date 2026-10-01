// ====================================================================
// SUPABASE EDGE FUNCTION PARA GEMINI AI (supabase/functions/gemini-chat/index.ts)
// ====================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

interface GeminiPart {
  text?: string;
  inlineData?: {
    mimeType: string;
    data: string;
  };
  functionCall?: {
    name: string;
    args: Record<string, any>;
  };
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

interface RequestBody {
  prompt?: string;
  message?: string;
  history?: Array<{ role: string; content: string }>;
  image?: string;
  image_url?: string;
  knowledge_context?: string;
  location_context?: string;
}

interface FunctionParameterProperty {
  type: string;
  description: string;
}

interface FunctionDeclaration {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, FunctionParameterProperty>;
    required?: string[];
  };
}

interface ToolDeclaration {
  functionDeclarations: FunctionDeclaration[];
}

function sanitizeAIResponse(text: string): string {
  if (!text) return '';
  let clean = text;

  clean = clean.replace(/<(thought|think)[\s\S]*?<\/\1>/gi, '');
  clean = clean.replace(/(question \d+:|knowledge areas:|steps \(|self-correction|drafting:|persona:|constraint:|\"como se hace|\"how to make)[\s\S]*?(?=\n\n[A-Z¡¿"']|Para |El |Hola |¡Hola |$)/gi, '');
  clean = clean.replace(/(pensamiento|thought|reasoning|proceso de pensamiento):[\s\S]*?(?=\n\n|\n[A-Z¡¿"']|$)/gi, '');

  const lines = clean.split('\n');
  const filtered = lines.filter(line => {
    const trimmed = line.trim();
    const lower = trimmed.toLowerCase();
    if (trimmed.startsWith('*') && (
      lower.includes('user input') ||
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
      lower.includes('tres leches')
    )) {
      return false;
    }
    return true;
  });

  clean = filtered.join('\n').trim();
  clean = clean.replace(/[*_~`#]/g, '').trim();

  return clean;
}

const TOOL_DECLARATIONS: ToolDeclaration[] = [
  {
    functionDeclarations: [
      {
        name: "crear_alarma",
        description: "Crea y programa una nueva alarma sonora con hora fija (HH:MM). Usar SOLO para despertares o alertas horarias.",
        parameters: {
          type: "OBJECT",
          properties: {
            nombre: { type: "STRING", description: "Titulo o nombre descriptivo de la alarma" },
            hora: { type: "STRING", description: "Hora de la alarma en formato 24h (HH:MM)" },
            fecha: { type: "STRING", description: "Fecha opcional en formato YYYY-MM-DD" },
            mensaje: { type: "STRING", description: "Mensaje que la IA hablara al sonar la alarma" }
          },
          required: ["nombre", "hora"]
        }
      },
      {
        name: "crear_recordatorio",
        description: "Crea un recordatorio agendado con fecha y/o hora (HH:MM) para recordar un evento o tarea en un momento especifico. NO usar para notas o listas de compras sin hora.",
        parameters: {
          type: "OBJECT",
          properties: {
            nombre: { type: "STRING", description: "Asunto o titulo del recordatorio" },
            hora: { type: "STRING", description: "Hora de ejecucion (HH:MM)" },
            fecha: { type: "STRING", description: "Fecha de ejecucion (YYYY-MM-DD)" },
            mensaje: { type: "STRING", description: "Texto detallado que dira la IA" }
          },
          required: ["nombre", "hora"]
        }
      },
      {
        name: "eliminar_alarma",
        description: "Elimina una alarma o recordatorio buscando por su nombre.",
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
        description: "Consulta todas las alarmas y recordatorios actualmente activos o programados.",
        parameters: {
          type: "OBJECT",
          properties: {}
        }
      },
      {
        name: "crear_conocimiento_faq",
        description: "Guarda un nuevo conocimiento o pregunta frecuente (FAQ) en aprender.html.",
        parameters: {
          type: "OBJECT",
          properties: {
            titulo: { type: "STRING", description: "Titulo o pregunta FAQ" },
            contenido: { type: "STRING", description: "Contenido, respuesta o explicacion detallada" }
          },
          required: ["titulo", "contenido"]
        }
      },
      {
        name: "crear_nota",
        description: "Crea y guarda una NOTA o apunte tipo Post-it (por ejemplo: lista de compras, anotaciones, memos, ideas, listas de tareas o notas con fotos). Usar SIEMPRE que el usuario mencione 'nota', 'post-it', 'anota', 'haz una nota' o pida guardar una lista sin hora especifica.",
        parameters: {
          type: "OBJECT",
          properties: {
            titulo: { type: "STRING", description: "Titulo o nombre de la nota post-it" },
            contenido: { type: "STRING", description: "Texto, elementos de la lista o detalles de la nota" },
            image_url: { type: "STRING", description: "URL o Base64 de la imagen adjunta opcional" },
            color: { type: "STRING", description: "Color pastel opcional (#fef08a, #fbcfe8, #bae6fd, #bbf7d0, #e9d5ff)" }
          },
          required: ["titulo"]
        }
      },
      {
        name: "llamar_contacto",
        description: "Busca a una persona en los contactos por su nombre y abre la app de llamadas del teléfono.",
        parameters: {
          type: "OBJECT",
          properties: {
            nombre: { type: "STRING", description: "Nombre de la persona a llamar" }
          },
          required: ["nombre"]
        }
      },
      {
        name: "guardar_contacto",
        description: "Guarda un nuevo número de teléfono con el nombre de la persona en la libreta de contactos.",
        parameters: {
          type: "OBJECT",
          properties: {
            nombre: { type: "STRING", description: "Nombre completo de la persona" },
            telefono: { type: "STRING", description: "Número de teléfono" }
          },
          required: ["nombre", "telefono"]
        }
      }
    ]
  }
];

async function discoverAvailableGeminiModels(apiKey: string): Promise<string[]> {
  const versions = ['v1beta', 'v1'];
  const foundModels: string[] = [];

  for (const ver of versions) {
    try {
      const url = `https://generativelanguage.googleapis.com/${ver}/models?key=${apiKey}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.models)) {
          for (const m of data.models) {
            if (m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent')) {
              const nameOnly = m.name.replace(/^models\//, '');
              if (!foundModels.includes(nameOnly)) {
                foundModels.push(nameOnly);
              }
            }
          }
        }
      }
    } catch (e) {
      console.warn(`Error descubriendo modelos en version ${ver}:`, e);
    }
  }

  if (foundModels.length === 0) {
    return [
      'gemini-1.5-flash-latest',
      'gemini-1.5-flash',
      'gemini-1.5-flash-002',
      'gemini-1.5-pro-latest',
      'gemini-1.5-pro',
      'gemini-2.0-flash-exp'
    ];
  }

  return foundModels;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body: RequestBody = await req.json().catch(() => ({}));
    const { prompt, message, history, image, image_url } = body;
    const userPrompt = (prompt || message || 'Hola').trim();

    const apiKey = (
      Deno.env.get('GEMINI_API_KEY') ||
      Deno.env.get('OPENAI_API_KEY') ||
      ''
    ).trim();

    if (!apiKey) {
      return new Response(
        JSON.stringify({
          reply: 'Error: No se encontró la API Key de Gemini en los Secrets de Supabase (GEMINI_API_KEY).'
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const candidateModels = await discoverAvailableGeminiModels(apiKey);
    const contents: GeminiContent[] = [];

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

    const currentParts: GeminiPart[] = [];

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
          text: `Eres un asistente de Inteligencia Artificial extraordinariamente inteligente, capaz, brillante, alegre y atento. No tienes nombre.
Tienes conocimientos amplios y profundos sobre programación, matemáticas, física, tecnología, cocina, ciencias, modelado 3D (Blender, GLB/GLTF), desarrollo web y conversación general.

REGLAS ABSOLUTAS E IMPERATIVAS:
1. Responde UNICAMENTE con la respuesta final directa y clara en español.
2. Queda STRICTAMENTE PROHIBIDO incluir pensamientos internos, notas de razonamiento, traducciones al inglés, borradores de pasos, desgloses de preguntas o metacomentarios.
3. Si te hacen preguntas matemáticas o de cálculo (por ejemplo "1 mas 1"), responde el resultado directo ("El resultado de 1 + 1 es 2").
4. Si te piden explicaciones o recetas (por ejemplo pastel de 3 leches o importar GLB a Blender), entrega la guía completa paso a paso con todos sus detalles directamente en español sin prefijos ni borradores.
5. NUNCA respondas con plantillas ni mensajes evasivos como "Con mucho gusto te ayudo, ¿qué aspecto quieres profundizar?". RESPONDE DE UNA VEZ LA CONSULTA.
6. DISTINCION CRITICA ENTRE NOTAS, RECORDATORIOS Y ALARMAS:
   - NOTAS: Si el usuario te pide "crea una nota...", "guarda una nota...", "anota...", "haz una lista de...", o menciona "post-it", DEBES invocar OBLIGATORIAMENTE la herramienta 'crear_nota'. NUNCA crees un recordatorio ni una alarma cuando pidan una nota.
   - Si el usuario te pide crear una nota pero NO ha indicado con qué nombre o título desea guardarla, PREGÚNTALE DIRECTAMENTE: "¿Con qué nombre te gustaría guardar tu nota?".
   - RECORDATORIOS: Invoca 'crear_recordatorio' SOLO cuando te pidan explícitamente recordar algo a una hora/fecha determinada ("recuérdame a las 5", "crea un recordatorio para mañana").
   - ALARMAS: Invoca 'crear_alarma' SOLO cuando pidan una alarma sonora o despertar a una hora determinada ("pon una alarma a las 7 am").`
        }
      ]
    };

    let geminiRes: Response | null = null;
    let aiData: any = null;
    let lastApiError: string = '';

    for (const modelName of candidateModels) {
      const apiVersion = modelName.includes('2.0') ? 'v1beta' : 'v1beta';
      const geminiUrl = `https://generativelanguage.googleapis.com/${apiVersion}/models/${modelName}:generateContent?key=${apiKey}`;

      const generationConfig: Record<string, any> = {
        temperature: 0.7,
        maxOutputTokens: 2048,
        thinkingConfig: {
          thinkingBudget: 0
        }
      };

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
          console.warn(`Intento fallido con modelo ${modelName}:`, data.error.message);
        }
      } catch (e: any) {
        lastApiError = `[${modelName}] ${e.message}`;
        console.warn(`Excepcion llamando a ${modelName}:`, e);
      }
    }

    if (!geminiRes || !aiData) {
      return new Response(
        JSON.stringify({
          reply: `Error de comunicacion con Google Gemini. Detalle: ${lastApiError || 'No hay modelos disponibles.'}`
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

    const cleanReply = sanitizeAIResponse(rawReply);

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
