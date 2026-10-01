// ====================================================================
// EDGE FUNCTION EXCLUSIVA PARA NOTAS (notas/index.ts)
// ====================================================================
// Esta Edge Function en TypeScript se llama exactamente `notas`
// y se encarga EXCLUSIVAMENTE de procesar peticiones para crear y guardar
// notas post-it con la Inteligencia Artificial (Gemini).
//
// CARACTERISTICAS:
// 1. Si el usuario NO indica un titulo/nombre para la nota, la IA le
//    PREGUNTA DIRECTAMENTE con que nombre desea guardarla.
// 2. Soporta adjuntar imagenes/fotos tomadas por la camara o cargadas.
// 3. Inserta directamente la nota en la tabla `notes` de Supabase.
// ====================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

interface RequestBody {
  prompt?: string;
  message?: string;
  image?: string; // Base64 de la imagen o foto tomada
  image_url?: string;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body: RequestBody = await req.json().catch(() => ({}));
    const userMessage = (body.prompt || body.message || '').trim();
    const rawImage = body.image || body.image_url || null;

    const apiKey = (Deno.env.get('GEMINI_API_KEY') || '').trim();
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || 'https://qqjhadwxboeichxtxree.supabase.co';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || '';

    if (!userMessage && !rawImage) {
      return new Response(
        JSON.stringify({ reply: '¿Qué te gustaría anotar en tu nota?' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Declaracion de Function Calling exclusiva para Crear Nota
    const tools = [
      {
        functionDeclarations: [
          {
            name: "crear_nota",
            description: "Guarda una nota post-it especifica con titulo, contenido e imagen opcional.",
            parameters: {
              type: "OBJECT",
              properties: {
                titulo: { type: "STRING", description: "Titulo o nombre especifico asignado a la nota" },
                contenido: { type: "STRING", description: "Detalles o texto redactado de la nota" },
                image_url: { type: "STRING", description: "URL o Base64 de la foto/imagen adjunta" },
                color: { type: "STRING", description: "Color pastel (#fef08a, #fbcfe8, #bae6fd, #bbf7d0, #e9d5ff)" }
              },
              required: ["titulo"]
            }
          }
        ]
      }
    ];

    const systemInstruction = {
      parts: [
        {
          text: `Eres una asistente alegre y eficiente especializada en gestionar notas post-it.
REGLAS ESTRICTAS PARA NOTAS:
1. Si el usuario te pide crear una nota o tomar una foto para una nota pero NO ha indicado con qué nombre o título desea guardarla, PREGÚNTALE DIRECTAMENTE: "¿Con qué nombre te gustaría guardar tu nota?".
2. Si el usuario ya te dio un nombre para la nota o responde a tu pregunta con un nombre, llama a la herramienta 'crear_nota' especificando el 'titulo' y 'contenido'.
3. Si hay una foto o imagen adjunta, pasala al parámetro 'image_url'.
4. Responde de forma muy breve, humana y amable en español, sin razonamientos internos.`
        }
      ]
    };

    const contents: any[] = [];
    const userParts: any[] = [];

    if (rawImage && typeof rawImage === 'string' && rawImage.includes('base64,')) {
      const mimeType = rawImage.substring(rawImage.indexOf(':') + 1, rawImage.indexOf(';'));
      const base64Data = rawImage.split(',')[1];
      userParts.push({
        inlineData: {
          mimeType: mimeType || 'image/jpeg',
          data: base64Data
        }
      });
    }

    userParts.push({ text: userMessage || 'Crear nota con esta foto' });
    contents.push({ role: 'user', parts: userParts });

    let reply = '';
    let toolCallExecuted = false;
    let savedNote: any = null;

    if (apiKey) {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
      const geminiRes = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ systemInstruction, contents, tools })
      });

      if (geminiRes.ok) {
        const data = await geminiRes.json();
        const candidate = data.candidates?.[0];
        const parts = candidate?.content?.parts || [];

        for (const part of parts) {
          if (part.text) reply += part.text;
          if (part.functionCall && part.functionCall.name === 'crear_nota') {
            const args = part.functionCall.args || {};
            const noteTitle = args.titulo || 'Nueva Nota';
            const noteContent = args.contenido || noteTitle;
            const noteColor = args.color || '#fef08a';
            const noteImg = args.image_url || rawImage || null;

            if (supabaseServiceKey) {
              const supabase = createClient(supabaseUrl, supabaseServiceKey);
              const { data: inserted, error } = await supabase.from('notes').insert([{
                title: noteTitle,
                content: noteContent,
                color: noteColor,
                image_url: noteImg
              }]).select();

              if (!error && inserted) {
                savedNote = inserted[0];
              }
            }

            toolCallExecuted = true;
            reply = `¡Listo! He guardado tu nota "${noteTitle}" en tu tablero de post-its.`;
          }
        }
      }
    }

    if (!reply) {
      const lower = userMessage.toLowerCase();
      let extractedTitle = userMessage.replace(/crea una nota|crear nota|haz una nota|anota|nota/gi, '').trim();

      if (!extractedTitle) {
        reply = '¿Con qué nombre te gustaría guardar tu nota?';
      } else {
        reply = `¡Nota "${extractedTitle}" creada y guardada con éxito!`;
      }
    }

    return new Response(
      JSON.stringify({ reply, savedNote, toolCallExecuted }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: any) {
    return new Response(
      JSON.stringify({ reply: 'Error procesando la nota: ' + err.message }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
