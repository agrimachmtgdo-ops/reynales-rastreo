-- =============================================================================
-- 1. Extensiones y tipos
-- Rastreo de camiones · Industrias Reynales
-- =============================================================================
-- En Supabase las extensiones viven en el esquema "extensions".
create schema if not exists extensions;
create extension if not exists postgis with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- Roles del personal de la fábrica (los choferes NO son personal: entran por invitación).
create type public.rol_personal as enum ('administrador', 'despacho', 'gerencia');

-- Etapas de cada camión. El orden importa: se usa para comparar "más o menos avanzado".
create type public.etapa_envio as enum (
  'programado',      -- despacho creó la misión y asignó el camión
  'cargado',         -- el chofer marcó "Iniciar viaje"
  'en_ruta',         -- salió de la geocerca de la fábrica
  'en_frontera',     -- entró a la geocerca de Desaguadero u otro paso
  'cruzo_frontera',  -- salió de la geocerca fronteriza hacia el destino
  'entregado',       -- el chofer marcó "Entregado"
  'cancelado'
);

create type public.tipo_ubicacion as enum ('fabrica', 'frontera', 'destino', 'punto_ruta');
create type public.tipo_evento as enum ('cambio_etapa', 'incidencia', 'emergencia', 'nota');
create type public.origen_evento as enum ('chofer', 'geocerca', 'despacho', 'sistema');
create type public.tipo_documento as enum ('factura', 'guia', 'dex', 'crt', 'mic_dta', 'certificado_origen', 'otro');
create type public.canal_aviso as enum ('whatsapp', 'correo');
create type public.estado_enlace as enum ('activo', 'revocado');
