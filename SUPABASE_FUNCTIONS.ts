// ====================================================================
// SUPABASE EDGE FUNCTION PARA GEMINI AI (gemini-chat/index.ts)
// ====================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { prompt, message, image, image_url } = body;
    const userPrompt = prompt || message || 'Hola';

    const apiKey = (Deno.env.get('GEMINI_API_KEY') || Deno.env.get('OPENAI_API_KEY') || '').trim();

    if (!apiKey) {
      return new Response(
        JSON.stringify({ reply: 'Error: No se encontró la API Key de Gemini en los Secrets (GEMINI_API_KEY o OPENAI_API_KEY).' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 1. Consultar modelos disponibles en Google Gemini
    let availableModels: string[] = [];
    try {
      const listRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
      const listData = await listRes.json();

      if (listRes.ok && listData.models) {
        availableModels = listData.models
          .filter((m: any) => m.supportedGenerationMethods?.includes('generateContent') && !m.name.includes('deprecated'))
          .map((m: any) => m.name);
      }
    } catch (e) {
      console.warn('Error listando modelos de Gemini:', e);
    }

    // Fallback si no se obtuvieron modelos de la lista
    if (availableModels.length === 0) {
      availableModels = ['models/gemini-1.5-flash', 'models/gemini-1.5-pro', 'models/gemini-2.0-flash'];
    }

    // 2. Preparar el contenido (texto e imagen base64 si aplica)
    const parts: Array<{ text?: string; inline_data?: { mime_type: string; data: string } }> = [];

    const rawImageData = image || image_url;
    if (rawImageData && typeof rawImageData === 'string' && rawImageData.includes('base64,')) {
      const mimeType = rawImageData.substring(rawImageData.indexOf(':') + 1, rawImageData.indexOf(';'));
      const base64Data = rawImageData.split(',')[1];
      parts.push({
        inline_data: {
          mime_type: mimeType || 'image/jpeg',
          data: base64Data
        }
      });
    }

    parts.push({ text: userPrompt });
    const contents = [{ parts }];

    // 3. Probar con los modelos disponibles hasta obtener respuesta exitosa
    let geminiRes: Response | null = null;
    let aiData: any = null;

    for (const modelName of availableModels) {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/${modelName}:generateContent?key=${apiKey}`;

      try {
        const res = await fetch(geminiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents })
        });

        const data = await res.json();
        if (res.ok && data.candidates) {
          geminiRes = res;
          aiData = data;
          break;
        }
      } catch (e) {
        console.warn(`Error llamando a modelo ${modelName}:`, e);
      }
    }

    if (!geminiRes || !aiData) {
      return new Response(
        JSON.stringify({ reply: 'Error al comunicarse con la IA de Google Gemini. Verifica tu API Key y permisos de modelo.' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const candidate = aiData.candidates?.[0];
    const resParts = candidate?.content?.parts || [];
    let reply = '';

    for (const part of resParts) {
      if (part.text) reply += part.text;
    }

    if (!reply.trim()) {
      reply = 'No pude procesar la respuesta.';
    }

    return new Response(
      JSON.stringify({ reply }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    return new Response(
      JSON.stringify({ reply: 'Error interno: ' + error.message }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
