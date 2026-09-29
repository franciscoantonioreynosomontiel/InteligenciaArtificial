-- ====================================================================
-- ESQUEMA DE BASE DE DATOS SUPABASE - TABLA EXCLUSIVA PARA UBICACIONES
-- ====================================================================
-- Este archivo contiene UNICAMENTE la estructura SQL para la tabla `locations`
-- que permite almacenar la ubicación GPS de los dos dispositivos que usan la PWA.

CREATE TABLE IF NOT EXISTS locations (
  device_id TEXT PRIMARY KEY,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  address TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Habilitar Row Level Security (RLS)
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;

-- Politica para permitir Lectura, Insercion, Actualizacion y Eliminacion Publica
DROP POLICY IF EXISTS "Public full access locations" ON locations;
CREATE POLICY "Public full access locations" ON locations FOR ALL USING (true) WITH CHECK (true);
