// ====================================================================
// EDGE FUNCTION EXCLUSIVA PARA CONSULTA Y PROCESAMIENTO DE UBICACIONES
// ====================================================================
// Este archivo contiene la lógica TypeScript/Deno para la función Edge `ubicacion`
// que permite obtener la ubicación GPS y dirección de ambos dispositivos registrados.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || 'https://qqjhadwxboeichxtxree.supabase.co';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    const { data: locations, error } = await supabase
      .from('locations')
      .select('*')
      .order('updated_at', { ascending: false });

    if (error) {
      throw error;
    }

    return new Response(
      JSON.stringify({ locations }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
