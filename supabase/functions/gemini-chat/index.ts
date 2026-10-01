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
        description: "Crea y guarda una NUEVA nota tipo Post-it o lista de compras/tareas. Si la nota con ese titulo ya existe, se debe preferir 'editar_nota' para no duplicarla.",
        parameters: {
          type: "OBJECT",
          properties: {
            titulo: { type: "STRING", description: "Titulo o nombre de la nota post-it (ej: 'lista de compras')" },
            contenido: { type: "STRING", description: "Texto descriptivo o anotacion general de la nota" },
            items: { type: "STRING", description: "Elementos o lista de items separados por coma o salto de linea para checkbox" },
            image_url: { type: "STRING", description: "URL o Base64 de la imagen adjunta opcional" },
            color: { type: "STRING", description: "Color pastel opcional (#fef08a, #fbcfe8, #bae6fd, #bbf7d0, #e9d5ff)" }
          },
          required: ["titulo"]
        }
      },
      {
        name: "editar_nota",
        description: "Edita, actualiza o modifica una nota post-it existente (agrega elementos a la lista, cambia contenido o color). NUNCA crees una nota nueva si te piden editar o agregar cosas a una existente.",
        parameters: {
          type: "OBJECT",
          properties: {
            titulo_buscar: { type: "STRING", description: "Nombre o titulo actual de la nota a modificar (ej: 'lista de compras')" },
            nuevo_titulo: { type: "STRING", description: "Nuevo titulo opcional si se desea renombrar" },
            nuevo_contenido: { type: "STRING", description: "Nuevo texto descriptivo si se desea cambiar" },
            agregar_items: { type: "STRING", description: "Nuevos elementos o lista de items a agregar a la nota con checkbox (separados por coma)" },
            nuevo_color: { type: "STRING", description: "Nuevo color pastel opcional (#fef08a, #fbcfe8, #bae6fd, #bbf7d0, #e9d5ff)" }
          },
          required: ["titulo_buscar"]
        }
      },
      {
        name: "eliminar_nota",
        description: "Elimina permanentemente una nota post-it buscando por su titulo o nombre.",
        parameters: {
          type: "OBJECT",
          properties: {
            titulo: { type: "STRING", description: "Nombre o titulo de la nota post-it a eliminar" }
          },
          required: ["titulo"]
        }
      },
      {
        name: "marcar_item_nota",
        description: "Marca como comprado/completado (check) o desmarca (uncheck) uno o varios elementos de una lista dentro de una nota post-it (ej: 'ya compre salsa', 'marca perfume').",
        parameters: {
          type: "OBJECT",
          properties: {
            titulo_nota: { type: "STRING", description: "Nombre o titulo de la nota (ej: 'lista de compras')" },
            items: { type: "STRING", description: "Nombre del elemento o elementos a marcar o desmarcar (ej: 'salsa, azucar')" },
            completado: { type: "BOOLEAN", description: "true para marcar como listo/comprado/completado (✓), false para desmarcar" }
          },
          required: ["titulo_nota", "items"]
        }
      },
      {
        name: "consultar_notas",
        description: "Consulta o revisa las notas y listas guardadas para responder preguntas sobre su contenido o sobre que falta por comprar/completar.",
        parameters: {
          type: "OBJECT",
          properties: {
            query: { type: "STRING", description: "Filtro o nombre opcional de la nota a consultar" }
          }
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
6. DISTINCION CRITICA Y GESTION DE NOTAS Y LISTAS:
   - NOTAS Y LISTAS DE COMPRAS/TAREAS: Si el usuario menciona "nota", "post-it", "anota", "haz una lista...", o si pide guardar o modificar elementos sin hora especifica:
     - Para crear una NOTA NUEVA: usa 'crear_nota'. Si el usuario no indico el nombre/titulo, preguntale directamente: "¿Con qué nombre te gustaría guardar tu nota?".
     - Para MODIFICAR O AGREGAR elementos a una nota existente (ej: "agrega salsa a la lista de compras", "pon dentro esto", "cambia el color a rosado"): usa OBLIGATORIAMENTE 'editar_nota'. NUNCA dupliques ni crees otra nota si ya existe una nota previa relevante.
     - Para MARCAR ELEMENTOS COMPRADOS/COMPLETADOS (ej: "ya compré salsa", "marca perfume", "tacha azúcar"): usa OBLIGATORIAMENTE 'marcar_item_nota' con completado=true.
     - Para RESPONDER QUE FALTA POR COMPRAR O COMPLETAR: Revisa el contenido de las notas en el contexto recibido o invoca 'consultar_notas', y responde mencionando UNICAMENTE los elementos que aun NO estan marcados como completados ([ ]).
     - Para ELIMINAR una nota: usa 'eliminar_nota'.
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
