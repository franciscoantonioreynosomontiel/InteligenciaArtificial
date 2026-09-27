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

  // 1. If response contains meta-text or bullet thought lists, extract the last quoted string or paragraph
  if (cleaned.includes('* User input') || cleaned.includes('* Persona') || cleaned.includes('* Constraints') || cleaned.includes('* Direct answer')) {
    const quotesMatch = [...cleaned.matchAll(/"([^"\n\r]{5,})"/g)];
    if (quotesMatch.length > 0) {
      cleaned = quotesMatch[quotesMatch.length - 1][1];
    } else {
      const lines = cleaned.split('\n').filter(l => !l.trim().startsWith('*'));
      cleaned = lines.join(' ').trim();
    }
  }

  // 2. Remove markdown symbols and quotes
  cleaned = cleaned.replace(/[*_~`"]/g, '').trim();

  // 3. Remove duplicate sentences if AI repeated itself
  const sentences = cleaned.split(/(?<=[.!?¡¿])\s+/).map(s => s.trim()).filter(Boolean);
  const uniqueSentences: string[] = [];
  for (const sentence of sentences) {
    if (!uniqueSentences.includes(sentence)) {
      uniqueSentences.push(sentence);
    }
  }

  return uniqueSentences.join(' ').trim() || cleaned;
}

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

    // Fast direct model selection
    const availableModels = ['models/gemini-1.5-flash', 'models/gemini-1.5-pro', 'models/gemini-2.0-flash'];

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

    const systemInstruction = {
      parts: [
        {
          text: "Eres una asistente virtual alegre, amable, entusiasta y muy inteligente. Reglas estrictas e inviolables:\n1. Responde SIEMPRE únicamente la respuesta final directa al usuario.\n2. NUNCA incluyas tu proceso de pensamiento, razonamiento interno, análisis, opciones alternativas ni notas explicativas.\n3. NUNCA respondas ni agregues traducciones o texto en inglés.\n4. Mantén un tono alegre, cálido, positivo y servicial en todo momento."
        }
      ]
    };

    // 3. Probar con los modelos de manera directa e hiper-rápida
    let geminiRes: Response | null = null;
    let aiData: any = null;

    for (const modelName of availableModels) {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/${modelName}:generateContent?key=${apiKey}`;

      try {
        const res = await fetch(geminiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ systemInstruction, contents })
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
    let rawReply = '';

    for (const part of resParts) {
      if (part.text) rawReply += part.text;
    }

    // Clean and sanitize response from thoughts, English meta-text, and prompt echo
    let cleanReply = cleanAIResponseText(rawReply);

    if (!cleanReply.trim()) {
      cleanReply = '¡Hola! ¡Qué gusto saludarte! ¿En qué te puedo ayudar hoy?';
    }

    return new Response(
      JSON.stringify({ reply: cleanReply }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    return new Response(
      JSON.stringify({ reply: 'Error interno: ' + error.message }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
