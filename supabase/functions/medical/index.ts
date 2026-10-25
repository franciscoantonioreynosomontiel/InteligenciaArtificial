// ====================================================================
// SUPABASE EDGE FUNCTION PARA ASISTENTE MEDICO (supabase/functions/medical/index.ts)
// ====================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

interface PatientProfile {
  age?: number | string;
  gender?: string;
  height?: string;
  weight?: string;
  blood_type?: string;
  allergies?: string;
  hereditary_diseases?: string;
  chronic_conditions?: string;
  medications?: string;
  notes?: string;
}

interface RequestBody {
  prompt?: string;
  message?: string;
  history?: Array<{ role: string; content: string }>;
  patient_profile?: PatientProfile;
  consultation_title?: string;
}

function sanitizeAIResponse(text: string): string {
  if (!text) return '';
  let clean = text;

  clean = clean.replace(/<(thought|think)[\s\S]*?<\/\1>/gi, '');
  clean = clean.replace(/(pensamiento|thought|reasoning|proceso de pensamiento):[\s\S]*?(?=\n\n|\n[A-Z¡¿"']|$)/gi, '');
  clean = clean.replace(/[*_~`#]/g, '').trim();

  return clean;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body: RequestBody = await req.json().catch(() => ({}));
    const { prompt, message, history, patient_profile, consultation_title } = body;
    const userPrompt = (prompt || message || 'Hola').trim();

    let profileContextStr = '';
    if (patient_profile && typeof patient_profile === 'object') {
      const parts = [];
      if (patient_profile.age) parts.push(`Edad: ${patient_profile.age}`);
      if (patient_profile.gender) parts.push(`Género: ${patient_profile.gender}`);
      if (patient_profile.height) parts.push(`Altura: ${patient_profile.height}`);
      if (patient_profile.weight) parts.push(`Peso: ${patient_profile.weight}`);
      if (patient_profile.blood_type) parts.push(`Tipo de sangre: ${patient_profile.blood_type}`);
      if (patient_profile.allergies) parts.push(`Alergias: ${patient_profile.allergies}`);
      if (patient_profile.hereditary_diseases) parts.push(`Enfermedades hereditarias: ${patient_profile.hereditary_diseases}`);
      if (patient_profile.chronic_conditions) parts.push(`Enfermedades crónicas: ${patient_profile.chronic_conditions}`);
      if (patient_profile.medications) parts.push(`Medicamentos actuales: ${patient_profile.medications}`);
      if (patient_profile.notes) parts.push(`Notas adicionales: ${patient_profile.notes}`);

      if (parts.length > 0) {
        profileContextStr = `\n[PERFIL DEL PACIENTE PARA EVALUACIÓN CLÍNICA]:\n${parts.join('\n')}\nUtiliza estos datos del perfil para brindar una orientación médica más precisa y personalizada.\n`;
      }
    }

    let consultationContextStr = '';
    if (consultation_title) {
      consultationContextStr = `\n[TEMA DE LA CONSULTA ACTUAL]: ${consultation_title}\n`;
    }

    const apiKey = (
      Deno.env.get('medicalApi') ||
      Deno.env.get('MEDICAL_API_KEY') ||
      Deno.env.get('GEMINI_API_KEY') ||
      ''
    ).trim();

    if (!apiKey) {
      return new Response(
        JSON.stringify({
          reply: 'Error: No se encontró la clave API medicalApi en los Secrets de Supabase.'
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let openMedicalReply = '';

    // Intento 1: API de OpenMedical si el servicio responde directamente con formato OpenAI/OpenMedical
    try {
      const openMedRes = await fetch('https://api.openmedical.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'openmedical-default',
          messages: [
            {
              role: 'system',
              content: `Eres un Asistente Médico virtual responsable, empático, claro y profesional.
Tu objetivo es ayudar a orientar al usuario sobre molestias o síntomas de salud.${profileContextStr}${consultationContextStr}
REGLAS MANDATORIAS:
1. Haz preguntas de seguimiento para comprender mejor los síntomas.
2. Presenta posibles causas únicamente como orientación preliminar, SIN afirmar diagnósticos definitivos.
3. Identifica claramente señales de alarma y recomienda atención médica urgente cuando corresponda.
4. No inventes resultados médicos ni afirmes consultar sistemas externos si la consulta falla.
5. Responde siempre en español, con un tono humano, cercano y directo, sin razonamientos internos ni metacomentarios.`
            },
            ...(history || []).map(h => ({
              role: h.role === 'user' ? 'user' : 'assistant',
              content: h.content
            })),
            { role: 'user', content: userPrompt }
          ]
        })
      });

      if (openMedRes.ok) {
        const data = await openMedRes.json();
        if (data && data.choices && data.choices[0] && data.choices[0].message) {
          openMedicalReply = data.choices[0].message.content;
        }
      }
    } catch (e) {
      console.warn('OpenMedical direct call failed or unavailable, using medical AI model fallback:', e);
    }

    // Intento 2: Modelo LLM optimizado para atención médica si OpenMedical no devolvió respuesta
    if (!openMedicalReply) {
      const geminiApiKey = Deno.env.get('GEMINI_API_KEY') || apiKey;
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`;

      const contents = [];
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
      contents.push({ role: 'user', parts: [{ text: userPrompt }] });

      const res = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{
              text: `Eres un Asistente Médico virtual responsable, empático, claro y profesional.
Tu objetivo es orientar al usuario sobre molestias físicas, dolores o síntomas de salud.${profileContextStr}${consultationContextStr}

REGLAS ABSOLUTAS:
1. Haz preguntas de seguimiento claras y breves para comprender mejor los síntomas del usuario (duración, intensidad, factores desencadenantes).
2. Presenta posibles causas generales únicamente como orientación preliminar, SIN afirmar diagnósticos definitivos.
3. Identifica de inmediato señales de alarma (dolor de pecho opresivo, dificultad para respirar, pérdida de conciencia, debilidad súbita) y recomienda acudir urgentemente a un centro de salud o urgencias.
4. No inventes resultados médicos ni digas haber realizado pruebas físicas o de laboratorio.
5. Responde SIEMPRE en español con tono amable, humano, directo y conversacional.
6. Queda estrictamente PROHIBIDO incluir pensamientos internos, notas de proceso, razonamientos o meta-texto.`
            }]
          },
          contents,
          generationConfig: { temperature: 0.5, maxOutputTokens: 1024 }
        })
      });

      if (res.ok) {
        const data = await res.json();
        const candidate = data.candidates?.[0];
        const resParts = candidate?.content?.parts || [];
        for (const part of resParts) {
          if (part.text) openMedicalReply += part.text;
        }
      }
    }

    const cleanReply = sanitizeAIResponse(openMedicalReply || 'Comprendo lo que mencionas. Para ayudarte de la mejor manera, ¿podrías darme más detalles sobre desde cuándo sientes esta molestia y si se acompaña de algún otro síntoma?');

    return new Response(
      JSON.stringify({ reply: cleanReply }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    return new Response(
      JSON.stringify({ reply: 'Error al procesar la consulta médica: ' + error.message }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
