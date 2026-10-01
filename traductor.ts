// ====================================================================
// EDGE FUNCTION EXCLUSIVA PARA TRADUCTOR EN TIEMPO REAL (traductor.ts)
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
  audio_base64?: string;
  source_lang?: string;
}

interface TranslationResponse {
  original_text: string;
  detected_lang: 'en' | 'es' | 'other';
  target_lang: 'en' | 'es';
  translated_text: string;
  audio_base64?: string | null;
  error?: string;
}

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

    const systemInstruction = {
      parts: [
        {
          text: `Eres un traductor simultaneo profesional entre Ingles y Espanol.
TUS INSTRUCCIONES ESTRICTAS:
1. Analiza la intervencion del usuario.
2. Si el texto esta en INGLES (o predominantemente en ingles):
   - Detecta idioma: "en"
   - Idioma destino: "es"
   - Traduce al ESPANOL de manera natural, fluida y directa.
3. Si el texto esta en ESPANOL (o predominantemente en espanol):
   - Detecta idioma: "es"
   - Idioma destino: "en"
   - Traduce al INGLES de manera natural, fluida y directa.
4. RESPONDE UNICAMENTE EN FORMATO JSON STRICTO DE LA SIGUIENTE MANERA:
{
  "detected_lang": "en" | "es",
  "target_lang": "es" | "en",
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

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${geminiApiKey}`;

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

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      return new Response(
        JSON.stringify({ error: `Error en respuesta de Gemini: ${errText}` }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const aiData = await geminiRes.json();
    const rawReply = aiData.candidates?.[0]?.content?.parts?.[0]?.text || '';

    let parsedResult: { detected_lang: 'en' | 'es'; target_lang: 'en' | 'es'; translated_text: string } = {
      detected_lang: 'es',
      target_lang: 'en',
      translated_text: ''
    };

    try {
      const cleanJson = rawReply.replace(/```json/g, '').replace(/```/g, '').trim();
      parsedResult = JSON.parse(cleanJson);
    } catch (e) {
      const isEnglish = /[a-zA-Z]/.test(inputText) && !/[áéíóúñ¿¡]/i.test(inputText);
      parsedResult = {
        detected_lang: isEnglish ? 'en' : 'es',
        target_lang: isEnglish ? 'es' : 'en',
        translated_text: rawReply.trim()
      };
    }

    let audioBase64: string | null = null;

    if (elevenLabsApiKey && parsedResult.translated_text) {
      try {
        const defaultVoice = parsedResult.target_lang === 'en' ? '21m00Tcm4TlvDq8ikWAM' : 'EXAVITQu4vr4xnSDxMaL';
        const voiceId = body.voice_id || defaultVoice;
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
