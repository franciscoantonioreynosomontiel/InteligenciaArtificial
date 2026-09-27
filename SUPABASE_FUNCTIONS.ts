// ====================================================================
// SUPABASE EDGE FUNCTION PARA GEMINI AI (gemini-chat/index.ts)
// ====================================================================
// Esta funcion es la Edge Function avanzada para el asistente virtual Sara.
// Incorpora:
// 1. Detección dinamica de modelos de Google Gemini via `ListModels` API.
// 2. Soporte completo para Function Calling (creacion de alarmas, recordatorios, FAQs).
// 3. Conversacion fluida de varios turnos (multi-turn history).
// 4. Analisis de imagenes multimodal (vision).
// 5. Manejo avanzado de errores y reintentos automatizados sin frases estaticas.
// ====================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// Configuración de encabezados CORS para llamadas desde cualquier origen habilitado
const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

// Definicion de Interfaces de TypeScript
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

// Limpieza y sanitizacion estricta de las respuestas devueltas por el modelo
function sanitizeAIResponse(text: string): string {
  if (!text) return '';
  let clean = text;

  // 1. Eliminar bloques <thought> o <think> si el modelo los genera
  clean = clean.replace(/<(thought|think)[\s\S]*?<\/\1>/gi, '');

  // 2. Eliminar prefijos de razonamiento o etiquetas internas
  clean = clean.replace(/(pensamiento|thought|reasoning|proceso de pensamiento):[\s\S]*?(?=\n\n|\n[A-Z¡¿"']|$)/gi, '');

  // 3. Filtrar lineas de metadatos o viñetas internas en ingles
  const lines = clean.split('\n');
  const filtered = lines.filter(line => {
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

  clean = filtered.join('\n').trim();

  // 4. Limpiar formato sobrante de markdown
  clean = clean.replace(/[*_~`#]/g, '').trim();

  return clean;
}

// Herramientas / Declaracion de Funciones para Gemini Function Calling
const TOOL_DECLARATIONS: ToolDeclaration[] = [
  {
    functionDeclarations: [
      {
        name: "crear_alarma",
        description: "Crea y programa una nueva alarma especificando titulo, hora (HH:MM) y mensaje.",
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
        description: "Crea y guarda un recordatorio para el usuario especificando hora y tema.",
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
      }
    ]
  }
];

// Descubrimiento dinamico de modelos disponibles via ListModels API
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
              // Extraer nombre del modelo (ej: "models/gemini-1.5-flash-latest" -> "gemini-1.5-flash-latest")
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

  // Si no se pudo listar por permisos, devolver lista jerarquica con sufijos -latest / -001
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
    const { prompt, message, history, image, image_url, knowledge_context } = body;
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

    // 1. Descubrimiento automatico de modelos activos
    const candidateModels = await discoverAvailableGeminiModels(apiKey);

    // 2. Construcción de los contenidos
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

    // 3. Definicion del prompt de sistema
    const systemInstruction = {
      parts: [
        {
          text: `Eres Sara, un asistente de Inteligencia Artificial extraordinariamente inteligente, capaz, brillante, alegre y atenta.
Tienes conocimientos amplios y profundos sobre programación, matemáticas, física, tecnología, cocina, ciencias, modelado 3D (Blender, GLB/GLTF), desarrollo web y conversación general.

INSTRUCCIONES CLAVE:
1. Responde a CUALQUIER pregunta de forma directa, inteligente, clara y completa en español.
2. Si te hacen preguntas matemáticas o de cálculo (por ejemplo "1 mas 1"), responde el resultado directo ("El resultado de 1 + 1 es 2").
3. Si te piden explicaciones o recetas (por ejemplo pastel de 3 leches o importar GLB a Blender), da la guía completa paso a paso con todos sus detalles.
4. NUNCA respondas con plantillas ni mensajes evasivos como "Con mucho gusto te ayudo, ¿qué aspecto quieres profundizar?". RESPONDE DE UNA VEZ LA CONSULTA.
5. Si el usuario te pide programar una alarma, recordatorio o guardar un tema, invoca la herramienta adecuada de function calling.
6. Manten un tono positivo, alegre y respetuoso en español.`
        }
      ]
    };

    let geminiRes: Response | null = null;
    let aiData: any = null;
    let lastApiError: string = '';

    // 4. Bucle inteligente de prueba entre modelos encontrados
    for (const modelName of candidateModels) {
      const apiVersion = modelName.includes('2.0') ? 'v1beta' : 'v1beta';
      const geminiUrl = `https://generativelanguage.googleapis.com/${apiVersion}/models/${modelName}:generateContent?key=${apiKey}`;

      const generationConfig: Record<string, any> = {
        temperature: 0.7,
        maxOutputTokens: 2048
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
