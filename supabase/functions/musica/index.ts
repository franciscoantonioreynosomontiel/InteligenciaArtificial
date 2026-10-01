// ====================================================================
// SUPABASE EDGE FUNCTION PARA REPRODUCTOR DE MÚSICA (supabase/functions/musica/index.ts)
// ====================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

interface Track {
  id?: string;
  title: string;
  artist: string;
  album: string;
  url: string;
  cover?: string;
  duration?: string;
}

interface RequestBody {
  prompt?: string;
  message?: string;
  history?: Array<{ role: string; content: string }>;
  library?: Track[];
  current_index?: number;
  is_playing?: boolean;
  volume?: number;
}

function sanitizeAIResponse(text: string): string {
  if (!text) return '';
  let clean = text;
  clean = clean.replace(/<(thought|think)[\s\S]*?<\/\1>/gi, '');
  clean = clean.replace(/(pensamiento|thought|reasoning|proceso de pensamiento):[\s\S]*?(?=\n\n|\n[A-Z¡¿"']|$)/gi, '');
  clean = clean.replace(/[*_~`#]/g, '').trim();
  return clean;
}

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
      'gemini-1.5-pro-latest',
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
    const userPrompt = (body.prompt || body.message || 'ponme musica').trim();
    const library: Track[] = Array.isArray(body.library) ? body.library : [];
    const currentIndex = typeof body.current_index === 'number' ? body.current_index : 0;
    const isPlaying = Boolean(body.is_playing);
    const currentVolume = typeof body.volume === 'number' ? body.volume : 0.8;

    const apiKey = (
      Deno.env.get('GEMINI_API_KEY') ||
      Deno.env.get('OPENAI_API_KEY') ||
      ''
    ).trim();

    // Local heuristic search on catalog first for accuracy
    const lowerPrompt = userPrompt.toLowerCase();

    let matchedAction: string | null = null;
    let matchedTrackIndex: number = -1;
    let matchedAlbumTracks: number[] = [];
    let matchedArtistTracks: number[] = [];
    let targetVolume: number = currentVolume;
    let aiMessage = '';

    // Check volume commands
    if (lowerPrompt.includes('sube el volumen') || lowerPrompt.includes('subir volumen') || lowerPrompt.includes('mas volumen')) {
      matchedAction = 'control_volume';
      targetVolume = Math.min(1.0, currentVolume + 0.2);
      aiMessage = 'Subiendo el volumen.';
    } else if (lowerPrompt.includes('baja el volumen') || lowerPrompt.includes('bajar volumen') || lowerPrompt.includes('menos volumen')) {
      matchedAction = 'control_volume';
      targetVolume = Math.max(0.0, currentVolume - 0.2);
      aiMessage = 'Bajando el volumen.';
    } else if (lowerPrompt.includes('volumen al') || lowerPrompt.includes('pon el volumen en')) {
      const volMatch = lowerPrompt.match(/(\d{1,3})\s*%/);
      if (volMatch) {
        const percentage = parseInt(volMatch[1], 10);
        targetVolume = Math.max(0.0, Math.min(1.0, percentage / 100));
        matchedAction = 'control_volume';
        aiMessage = `Ajustando el volumen al ${percentage}%.`;
      }
    }

    // Check pause / play / next / prev
    if (!matchedAction) {
      if (lowerPrompt.includes('pausa') || lowerPrompt.includes('pausar') || lowerPrompt.includes('deten') || lowerPrompt.includes('detener') || lowerPrompt.includes('stop')) {
        matchedAction = 'control_playback';
        aiMessage = 'Música pausada.';
      } else if (lowerPrompt === 'play' || lowerPrompt === 'reproducir' || lowerPrompt === 'reproducete') {
        matchedAction = 'control_playback';
        aiMessage = 'Reproduciendo música.';
      } else if (lowerPrompt.includes('siguiente') || lowerPrompt.includes('siguiente cancion') || lowerPrompt.includes('cambia de cancion') || lowerPrompt.includes('pasa a la siguiente')) {
        matchedAction = 'next_track';
        aiMessage = 'Cambiando a la siguiente canción.';
      } else if (lowerPrompt.includes('anterior') || lowerPrompt.includes('cancion anterior')) {
        matchedAction = 'prev_track';
        aiMessage = 'Volviendo a la canción anterior.';
      }
    }

    // Check song, album, or artist search in provided Cloudinary library
    if (!matchedAction && library.length > 0) {
      // 1. Check exact/partial song title match
      library.forEach((track, idx) => {
        const titleLower = (track.title || '').toLowerCase();
        if (titleLower && (lowerPrompt.includes(titleLower) || titleLower.includes(lowerPrompt.replace(/ponme|reproduce|cancion|pon|la cancion/g, '').trim()))) {
          matchedTrackIndex = idx;
        }
      });

      if (matchedTrackIndex !== -1) {
        matchedAction = 'play_track';
        const t = library[matchedTrackIndex];
        aiMessage = `Reproduciendo la canción "${t.title}" de ${t.artist}.`;
      } else {
        // 2. Check album match
        library.forEach((track, idx) => {
          const albumLower = (track.album || '').toLowerCase();
          if (albumLower && lowerPrompt.includes(albumLower)) {
            matchedAlbumTracks.push(idx);
          }
        });

        if (matchedAlbumTracks.length > 0) {
          matchedAction = 'play_album';
          matchedTrackIndex = matchedAlbumTracks[0];
          const t = library[matchedTrackIndex];
          aiMessage = `Reproduciendo el álbum "${t.album}". Primera canción: "${t.title}".`;
        } else {
          // 3. Check artist match
          library.forEach((track, idx) => {
            const artistLower = (track.artist || '').toLowerCase();
            if (artistLower && lowerPrompt.includes(artistLower)) {
              matchedArtistTracks.push(idx);
            }
          });

          if (matchedArtistTracks.length > 0) {
            matchedAction = 'play_artist';
            matchedTrackIndex = matchedArtistTracks[0];
            const t = library[matchedTrackIndex];
            aiMessage = `Reproduciendo canciones del cantante ${t.artist}. Sonando "${t.title}".`;
          }
        }
      }
    }

    // Check generic play request
    if (!matchedAction && (lowerPrompt.includes('ponme musica') || lowerPrompt.includes('quiero escuchar musica') || lowerPrompt.includes('pon musica') || lowerPrompt.includes('musica'))) {
      if (library.length > 0) {
        matchedAction = 'play_track';
        matchedTrackIndex = currentIndex >= 0 && currentIndex < library.length ? currentIndex : 0;
        const t = library[matchedTrackIndex];
        aiMessage = `¡Claro! Reproduciendo "${t.title}" de tu biblioteca.`;
      } else {
        matchedAction = 'navigate_musica';
        aiMessage = '¡Por supuesto! Vamos al reproductor de música.';
      }
    }

    // If song was specifically requested by name (e.g., "ponme la cancion X") but not found in library
    if (!matchedAction && (lowerPrompt.includes('cancion') || lowerPrompt.includes('album') || lowerPrompt.includes('cantante') || lowerPrompt.includes('ponme') || lowerPrompt.includes('reproduce'))) {
      const requestedTerm = userPrompt.replace(/ponme|reproduce|la cancion|el album|del cantante|cancion|album/gi, '').trim();
      matchedAction = 'not_found';
      aiMessage = `No tengo la canción o elemento "${requestedTerm || userPrompt}" en tu biblioteca de Cloudinary. Puedes subirla desde el menú.`;
    }

    // Ask Gemini if Gemini API key is present and we want an AI response enhancement
    if (apiKey && !aiMessage) {
      const candidateModels = await discoverAvailableGeminiModels(apiKey);
      const systemInstruction = {
        parts: [{
          text: `Eres el asistente de música de Amigo. Responde siempre de forma súper alegre, directa y en español.
Tanto si el usuario te pide una canción como si quiere controlar la música, dale una respuesta corta y motivadora.`
        }]
      };

      for (const modelName of candidateModels) {
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
        try {
          const res = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              systemInstruction,
              contents: [{ role: 'user', parts: [{ text: userPrompt }] }]
            })
          });
          if (res.ok) {
            const data = await res.json();
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) {
              aiMessage = sanitizeAIResponse(text);
              break;
            }
          }
        } catch (e) {}
      }
    }

    if (!aiMessage) {
      aiMessage = '¡Listo! Atendiendo tu solicitud de música.';
    }

    return new Response(
      JSON.stringify({
        action: matchedAction || 'general_reply',
        track_index: matchedTrackIndex,
        volume: targetVolume,
        reply: aiMessage
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    return new Response(
      JSON.stringify({
        action: 'error',
        reply: 'Ocurrió un error al procesar tu solicitud de música: ' + error.message
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
