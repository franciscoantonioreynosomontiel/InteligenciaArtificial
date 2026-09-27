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

  // 3. Remove meta-headers and bullet thought lists (e.g., * User input, * Thinking, * Direct answer, etc.)
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

  // 4. If quotes exist around direct speech, extract the final quoted response if available
  const quotesMatch = [...cleaned.matchAll(/"([^"\n\r]{3,})"/g)];
  if (quotesMatch.length > 0) {
    const lastQuote = quotesMatch[quotesMatch.length - 1][1].trim();
    if (lastQuote.length > 3) {
      cleaned = lastQuote;
    }
  }

  // 5. Remove leftover markdown symbols and formatting
  cleaned = cleaned.replace(/[*_~`#"]/g, '').trim();

  // 6. Deduplicate identical sentences
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

    // Direct model selection (flash 2.0 first, then 1.5 flash, then 1.5 pro)
    const availableModels = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'];

    // 2. Preparar el contenido (texto e imagen base64 si aplica)
    const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];

    const rawImageData = image || image_url;
    if (rawImageData && typeof rawImageData === 'string' && rawImageData.includes('base64,')) {
      const mimeType = rawImageData.substring(rawImageData.indexOf(':') + 1, rawImageData.indexOf(';'));
      const base64Data = rawImageData.split(',')[1];
      parts.push({
        inlineData: {
          mimeType: mimeType || 'image/jpeg',
          data: base64Data
        }
      });
    }

    parts.push({ text: userPrompt });
    const contents = [{ role: 'user', parts }];

    const systemInstruction = {
      parts: [
        {
          text: "Eres una asistente virtual alegre, amable, entusiasta y muy inteligente. Reglas estrictas e inviolables:\n1. Responde SIEMPRE ÚNICAMENTE con la respuesta final hablada en español directo al usuario.\n2. PROHIBIDO incluir pensamientos, razonamiento interno, procesos de pensamiento, notas en inglés o español, asteriscos o listas de tareas.\n3. Sé directa, alegre, cálida y muy rápida."
        }
      ]
    };

    // 3. Probar con los modelos de manera directa e hiper-rápida
    let geminiRes: Response | null = null;
    let aiData: any = null;
    let lastApiError: string = '';

    for (const modelName of availableModels) {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

      const generationConfig: Record<string, any> = {
        temperature: 0.7,
        maxOutputTokens: 1000
      };

      // Add thinkingConfig only for models supporting thinking budget
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
