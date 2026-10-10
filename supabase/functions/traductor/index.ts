// ====================================================================
// EDGE FUNCTION EXCLUSIVA PARA TRADUCTOR EN TIEMPO REAL (supabase/functions/traductor/index.ts)
// ====================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

interface TranslationRequest {
  text?: string;
  message?: string;
  voice_id?: string;
  voice_id_es?: string;
  voice_id_en?: string;
  audio_base64?: string;
  source_lang?: string;
  target_lang?: string;
}

interface TranslationResponse {
  original_text: string;
  detected_lang: 'en' | 'es' | 'other';
  target_lang: 'en' | 'es';
  translated_text: string;
  audio_base64?: string | null;
  error?: string;
}

const CANDIDATE_MODELS = [
  'gemini-1.5-flash-latest',
  'gemini-1.5-flash',
  'gemini-1.5-flash-002',
  'gemini-1.5-pro-latest',
  'gemini-1.5-pro',
  'gemini-2.0-flash-exp'
];

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body: TranslationRequest = await req.json().catch(() => ({}));
    const inputText = (body.text || body.message || '').trim();

    if (!inputText && !body.audio_base64) {
      return new Response(
        JSON.stringify({ error: 'No se recibio texto ni audio para traducir.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const geminiApiKey = (
      Deno.env.get('GEMINI_API_KEY') ||
      Deno.env.get('OPENAI_API_KEY') ||
      ''
    ).trim();

    const elevenLabsApiKey = (
      Deno.env.get('Voz') ||
      Deno.env.get('VOZ') ||
      Deno.env.get('ELEVENLABS_API_KEY') ||
      ''
    ).trim();

    if (!geminiApiKey) {
      return new Response(
        JSON.stringify({
          error: 'GEMINI_API_KEY no encontrada en los secrets de Supabase.'
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const explicitSource = body.source_lang ? body.source_lang.toLowerCase() : null;
    const explicitTarget = body.target_lang ? body.target_lang.toLowerCase() : null;

    const targetLangCode = explicitTarget || (explicitSource === 'es' ? 'en' : 'es');
    const sourceLangCode = explicitSource || (explicitTarget === 'en' ? 'es' : 'en');

    const systemInstruction = {
      parts: [
        {
          text: `Eres un traductor simultaneo profesional entre Ingles y Espanol.
TUS INSTRUCCIONES ESTRICTAS:
1. Traduce el texto entregado por el usuario del idioma origen "${sourceLangCode}" al idioma destino "${targetLangCode}".
   - Si source_lang es "es" y target_lang es "en": Traduce el texto en Español al Inglés.
   - Si source_lang es "en" y target_lang es "es": Traduce el texto en Inglés al Español.
2. RESPONDE UNICAMENTE EN FORMATO JSON STRICTO DE LA SIGUIENTE MANERA SIN TEXTO ADICIONAL:
{
  "detected_lang": "${sourceLangCode}",
  "target_lang": "${targetLangCode}",
  "translated_text": "Texto traducido aqui"
}`
        }
      ]
    };

    const contents = [
      {
        role: 'user',
        parts: [{ text: inputText }]
      }
    ];

    let rawReply = '';
    let lastError = '';

    for (const modelName of CANDIDATE_MODELS) {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiApiKey}`;

      try {
        const geminiRes = await fetch(geminiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction,
            contents,
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 1024,
              responseMimeType: "application/json"
            }
          })
        });

        if (geminiRes.ok) {
          const aiData = await geminiRes.json();
          rawReply = aiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
          if (rawReply) break;
        } else {
          const errText = await geminiRes.text();
          lastError = `[${modelName}] ${errText}`;
          console.warn(`Error llamando a modelo ${modelName}:`, errText);
        }
      } catch (e: any) {
        lastError = `[${modelName}] ${e.message}`;
        console.warn(`Excepción llamando a ${modelName}:`, e);
      }
    }

    if (!rawReply) {
      return new Response(
        JSON.stringify({ error: `Error en la traducción con Gemini: ${lastError || 'No fue posible obtener respuesta.'}` }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let parsedResult: { detected_lang: 'en' | 'es'; target_lang: 'en' | 'es'; translated_text: string } = {
      detected_lang: sourceLangCode as 'en' | 'es',
      target_lang: targetLangCode as 'en' | 'es',
      translated_text: ''
    };

    try {
      const cleanJson = rawReply.replace(/```json/gi, '').replace(/```/g, '').trim();
      parsedResult = JSON.parse(cleanJson);
    } catch (e) {
      parsedResult = {
        detected_lang: sourceLangCode as 'en' | 'es',
        target_lang: targetLangCode as 'en' | 'es',
        translated_text: rawReply.trim()
      };
    }

    let audioBase64: string | null = null;

    if (elevenLabsApiKey && parsedResult.translated_text) {
      try {
        // Use user's configured voice from aprender.html for both Spanish and English
        let voiceId = body.voice_id ||
          (parsedResult.target_lang === 'en' ? body.voice_id_en : body.voice_id_es) ||
          body.voice_id_es ||
          body.voice_id_en ||
          'EXAVITQu4vr4xnSDxMaL';

        const ttsUrl = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
        const ttsRes = await fetch(ttsUrl, {
          method: 'POST',
          headers: {
            'Accept': 'audio/mpeg',
            'Content-Type': 'application/json',
            'xi-api-key': elevenLabsApiKey
          },
          body: JSON.stringify({
            text: parsedResult.translated_text,
            model_id: 'eleven_multilingual_v2',
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75
            }
          })
        });

        if (ttsRes.ok) {
          const arrayBuf = await ttsRes.arrayBuffer();
          const bytes = new Uint8Array(arrayBuf);
          let binary = '';
          for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          audioBase64 = btoa(binary);
        } else {
          const ttsErr = await ttsRes.text();
          console.warn('ElevenLabs TTS response error:', ttsErr);
        }
      } catch (e) {
        console.warn('ElevenLabs TTS error in traductor Edge Function:', e);
      }
    }

    const responsePayload: TranslationResponse = {
      original_text: inputText,
      detected_lang: parsedResult.detected_lang,
      target_lang: parsedResult.target_lang,
      translated_text: parsedResult.translated_text,
      audio_base64: audioBase64
    };

    return new Response(
      JSON.stringify(responsePayload),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: 'Error interno en Edge Function traductor: ' + error.message }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
