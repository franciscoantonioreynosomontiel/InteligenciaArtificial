// ====================================================================
// EDGE FUNCTION EXCLUSIVA PARA TRADUCTOR EN TIEMPO REAL (traductor.ts)
// ====================================================================
// Esta Edge Function se encarga EXCLUSIVAMENTE de procesar traducciones
// bidireccionales en tiempo real entre Espanol e Ingles utilizando Google Gemini.
//
// CARACTERISTICAS:
// 1. Reutiliza la clave de API GEMINI_API_KEY existente.
// 2. Detección automatica de idioma por Gemini (Espanol o Ingles).
// 3. Traduce de Ingles a Espanol (para reproducir en audifonos) o de
//    Espanol a Ingles (para reproducir por el altavoz hacia la otra persona).
// 4. Integra opcionalmente ElevenLabs TTS si se configura ELEVENLABS_API_KEY
//    para generar audio en tiempo real de alta calidad.
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
  audio_base64?: string;
  source_lang?: string; // Opcional, si viene indicado
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

    const elevenLabsApiKey = (Deno.env.get('ELEVENLABS_API_KEY') || '').trim();

    if (!geminiApiKey) {
      return new Response(
        JSON.stringify({
          error: 'GEMINI_API_KEY no encontrada en los secrets de Supabase.'
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Promp de traduccion e identificacion automatica con Gemini
    const systemInstruction = {
      parts: [
        {
          text: `Eres un traductor simultaneo profesional y de ultralaja latencia entre Ingles y Espanol.
TUS INSTRUCCIONES STRICTAS:
1. Analiza la intervencion del usuario.
2. Si el texto esta en INGLES (o predominantemente en ingles):
   - Detecta idioma: "en"
   - Idioma destino: "es"
   - Traduce al ESPANOL de manera natural, fluida y directa.
3. Si el texto esta en ESPANOL (o predominantemente en espanol):
   - Detecta idioma: "es"
   - Idioma destino: "en"
   - Traduce al INGLES de manera natural, fluida y directa.
4. RESPONDE UNICAMENTE EN FORMATO JSON STRICTO SIN NINGUN OTRO TEXTO NI FORMATO MARKDOWN DE LA SIGUIENTE MANERA:
{
  "detected_lang": "en" | "es",
  "target_lang": "es" | "en",
  "translated_text": "Texto traducido aqui"
}
5. Queda estrictamente prohibido incluir comentarios, explicaciones, notas de pensamiento o marcas de markdown (\`\`\`json).`
        }
      ]
    };

    const contents = [
      {
        role: 'user',
        parts: [{ text: inputText }]
      }
    ];

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`;

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
      // Fallback si la respuesta no vino en JSON limpio
      const isEnglish = /[a-zA-Z]/.test(inputText) && !/[áéíóúñ¿¡]/i.test(inputText);
      parsedResult = {
        detected_lang: isEnglish ? 'en' : 'es',
        target_lang: isEnglish ? 'es' : 'en',
        translated_text: rawReply.trim()
      };
    }

    let audioBase64: string | null = null;

    // Si ElevenLabs API Key esta presente, generar voz TTS de baja latencia
    if (elevenLabsApiKey && parsedResult.translated_text) {
      try {
        const voiceId = parsedResult.target_lang === 'en' ? '21m00Tcm4TlvDq8ikWAM' : 'EXAVITQu4vr4xnSDxMaL'; // Rachel (EN) / Sarah (ES)
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
        console.warn('ElevenLabs TTS fallback to Web Speech API:', e);
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
      JSON.stringify({ error: 'Error interno en la Edge Function de traduccion: ' + error.message }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
