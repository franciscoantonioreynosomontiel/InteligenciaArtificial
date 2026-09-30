// ====================================================================
// EDGE FUNCTION PARA VOZ ELEVENLABS (supabase/functions/voz/index.ts)
// ====================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
};

const DEFAULT_ELEVENLABS_VOICES = [
  { voice_id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah / Bella (Premade)', category: 'premade', labels: { language: 'Spanish / English' } },
  { voice_id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel (Premade)', category: 'premade', labels: { language: 'Spanish / English' } },
  { voice_id: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi (Premade)', category: 'premade', labels: { language: 'Spanish / English' } },
  { voice_id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam (Premade)', category: 'premade', labels: { language: 'Spanish / English' } },
  { voice_id: 'ErXwobaYiN019PkySvjV', name: 'Antoni (Premade)', category: 'premade', labels: { language: 'Spanish / English' } },
  { voice_id: 'IKne3meq5aSn9XLyUdCD', name: 'Charlie (Premade)', category: 'premade', labels: { language: 'Spanish / English' } },
  { voice_id: 'XB0fDUnOXGF2VhhC2L9A', name: 'Charlotte (Premade)', category: 'premade', labels: { language: 'Spanish / English' } },
  { voice_id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel (Premade)', category: 'premade', labels: { language: 'Spanish / English' } },
  { voice_id: 'LcfcDJNUP1GQjkzn1xUU', name: 'Emily (Premade)', category: 'premade', labels: { language: 'Spanish / English' } },
  { voice_id: 'TX3LPaxmHKxFdv7VOQHJ', name: 'Liam (Premade)', category: 'premade', labels: { language: 'Spanish / English' } },
  { voice_id: 'piTKgcLEGmPE4e6mOjd8', name: 'Nicole (Premade)', category: 'premade', labels: { language: 'Spanish / English' } }
];

interface VoiceRequest {
  action?: 'get_voices' | 'text_to_speech' | string;
  text?: string;
  voice_id?: string;
  stability?: number;
  similarity_boost?: number;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const elevenLabsApiKey = (
      Deno.env.get('Voz') ||
      Deno.env.get('VOZ') ||
      Deno.env.get('ELEVENLABS_API_KEY') ||
      ''
    ).trim();

    if (!elevenLabsApiKey) {
      return new Response(
        JSON.stringify({
          error: 'No se encontro la API Key de ElevenLabs en los Secrets de Supabase. Asegurate de crear el Secret llamado Voz.'
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body: VoiceRequest = await req.json().catch(() => ({}));
    const action = body.action || (body.text ? 'text_to_speech' : 'get_voices');

    // Action 1: Obtener la lista de voces de la cuenta de ElevenLabs
    if (action === 'get_voices') {
      try {
        const voicesRes = await fetch('https://api.elevenlabs.io/v1/voices', {
          method: 'GET',
          headers: {
            'xi-api-key': elevenLabsApiKey,
            'Content-Type': 'application/json'
          }
        });

        if (!voicesRes.ok) {
          const errData = await voicesRes.json().catch(() => ({}));
          const isPermError = JSON.stringify(errData).includes('missing_permissions') || JSON.stringify(errData).includes('voices_read');

          if (isPermError) {
            return new Response(
              JSON.stringify({
                voices: DEFAULT_ELEVENLABS_VOICES,
                warning: 'La API key no tiene el permiso voices_read en ElevenLabs. Se han cargado las voces predeterminadas. Puedes otorgar el permiso voices_read en ElevenLabs para ver tus voces personalizadas.'
              }),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }

          return new Response(
            JSON.stringify({
              voices: DEFAULT_ELEVENLABS_VOICES,
              warning: `Error de autenticacion con ElevenLabs: ${errData.detail?.message || 'Verifica tu API key'}. Se muestran voces de tu cuenta.`
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const voicesData = await voicesRes.json();
        const voicesList = (voicesData.voices || []).map((v: any) => ({
          voice_id: v.voice_id,
          name: v.name,
          category: v.category,
          preview_url: v.preview_url,
          labels: v.labels
        }));

        return new Response(
          JSON.stringify({ voices: voicesList }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } catch (e: any) {
        return new Response(
          JSON.stringify({ voices: DEFAULT_ELEVENLABS_VOICES, warning: 'Error conectando con ElevenLabs. Mostrando voces de tu cuenta.' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Action 2: Generar audio con Text-to-Speech
    if (action === 'text_to_speech') {
      const text = (body.text || '').trim();
      const voiceId = body.voice_id || 'EXAVITQu4vr4xnSDxMaL'; // Sarah/Bella por defecto

      if (!text) {
        return new Response(
          JSON.stringify({ error: 'No se proporciono texto para sintetizar voz.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const ttsUrl = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
      const ttsRes = await fetch(ttsUrl, {
        method: 'POST',
        headers: {
          'Accept': 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': elevenLabsApiKey
        },
        body: JSON.stringify({
          text: text,
          model_id: 'eleven_multilingual_v2',
          voice_settings: {
            stability: typeof body.stability === 'number' ? body.stability : 0.5,
            similarity_boost: typeof body.similarity_boost === 'number' ? body.similarity_boost : 0.75
          }
        })
      });

      if (!ttsRes.ok) {
        const errText = await ttsRes.text();
        let errMsg = errText;
        try {
          const parsed = JSON.parse(errText);
          if (parsed?.detail?.code === 'paid_plan_required' || parsed?.detail?.type === 'payment_required') {
            errMsg = 'Las cuentas gratuitas de ElevenLabs no permiten sintetizar voces de la biblioteca (Library voices) via API. Por favor selecciona una voz nativa Premade (como Bella o Sarah) o actualiza tu plan en ElevenLabs.';
          } else if (parsed?.detail?.message) {
            errMsg = parsed.detail.message;
          }
        } catch (e) {
          // Mantiene el texto si no es JSON
        }

        return new Response(
          JSON.stringify({ error: `Error en ElevenLabs: ${errMsg}` }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const arrayBuf = await ttsRes.arrayBuffer();
      const bytes = new Uint8Array(arrayBuf);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const audioBase64 = btoa(binary);

      return new Response(
        JSON.stringify({
          success: true,
          voice_id: voiceId,
          audio_base64: audioBase64
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Accion no valida.' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: 'Error interno en la Edge Function de Voz: ' + error.message }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
