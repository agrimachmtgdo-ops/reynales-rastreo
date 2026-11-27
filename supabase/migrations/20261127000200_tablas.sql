-- =============================================================================
-- 2. Tablas principales (modelo de datos del plan)
-- =============================================================================
set search_path = public, extensions;

-- Marca de "actualizado_en" automática.
create or replace function public.tocar_actualizado_en()
returns trigger language plpgsql
set search_path = public as $$
begin
  new.actualizado_en := now();
  return new;
end $$;

-- Código legible de misión, ej. MSN-7K3QX9PA (sin letras que se confunden: 0/O, 1/I/L).
create or replace function public.generar_codigo(p_largo int)
returns text language plpgsql volatile
set search_path = public, extensions as $$
declare
  alfabeto constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  bytes bytea := extensions.gen_random_bytes(p_largo);
  resultado text := '';
begin
  for i in 0 .. p_largo - 1 loop
    resultado := resultado || substr(alfabeto, (get_byte(bytes, i) % length(alfabeto)) + 1, 1);
  end loop;
  return resultado;
end $$;

-- ---------------------------------------------------------------------------
-- Personal de la fábrica (enlazado a auth.users de Supabase)
-- ---------------------------------------------------------------------------
create table public.usuarios (
  id          uuid primary key references auth.users (id) on delete cascade,
  nombre      text not null,
  rol         public.rol_personal not null default 'despacho',
  activo      boolean not null default false,  -- un administrador lo activa
  creado_en   timestamptz not null default now()
);
comment on table public.usuarios is 'Personal de la fábrica: administrador, despacho y gerencia. Los choferes no van aquí.';

-- ---------------------------------------------------------------------------
-- Catálogos
-- ---------------------------------------------------------------------------
create table public.clientes (
  id            uuid primary key default gen_random_uuid(),
  razon_social  text not null,
  nit_ruc       text,                         -- NIT (Bolivia) o RUC (Perú)
  pais          char(2) not null default 'BO' check (pais in ('BO', 'PE')),
  contacto      text,
  whatsapp      text,
  correo        text,
  creado_en     timestamptz not null default now()
);

create table public.transportistas (
  id                          uuid primary key default gen_random_uuid(),
  razon_social                text not null,  -- o nombre del dueño
  nit                         text,
  contacto                    text,
  telefono                    text,
  clausula_rastreo_aceptada_en date,          -- cuándo aceptó las condiciones de rastreo
  cumplimiento_pct            numeric(5, 2),  -- se calcula en Fase 2
  creado_en                   timestamptz not null default now()
);

create table public.conductores (
  id                uuid primary key default gen_random_uuid(),
  transportista_id  uuid not null references public.transportistas (id) on delete restrict,
  nombre            text not null,
  ci                text,       -- solo uso interno, nunca se muestra al cliente
  telefono          text,       -- solo uso interno
  licencia          text,
  dispositivo_id    text,       -- último teléfono vinculado (Android ID)
  activo            boolean not null default true,
  creado_en         timestamptz not null default now()
);

create table public.vehiculos (
  id                uuid primary key default gen_random_uuid(),
  transportista_id  uuid not null references public.transportistas (id) on delete restrict,
  -- Placa en mayúsculas y sin espacios. Formato boliviano típico: 1234ABC.
  placa             text not null unique check (placa ~ '^[A-Z0-9-]{5,10}$'),
  marca             text,
  capacidad_tn      numeric(6, 2),
  creado_en         timestamptz not null default now()
);

create table public.ubicaciones (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null,
  direccion  text,
  ciudad     text,
  pais       char(2) not null default 'BO' check (pais in ('BO', 'PE')),
  tipo       public.tipo_ubicacion not null,
  lat        double precision not null check (lat between -90 and 90),
  lon        double precision not null check (lon between -180 and 180),
  -- Punto geográfico calculado para las consultas de geocercas (PostGIS).
  punto      extensions.geography(Point, 4326)
             generated always as (extensions.st_setsrid(extensions.st_makepoint(lon, lat), 4326)::extensions.geography) stored,
  radio_m    integer not null default 500 check (radio_m between 50 and 20000),
  activo     boolean not null default true,
  creado_en  timestamptz not null default now()
);
create index ubicaciones_punto_idx on public.ubicaciones using gist (punto);

-- ---------------------------------------------------------------------------
-- Misiones (un envío, puede llevar varios camiones)
-- ---------------------------------------------------------------------------
create table public.misiones (
  id                     uuid primary key default gen_random_uuid(),
  codigo                 text not null unique default ('MSN-' || public.generar_codigo(8)),
  cliente_id             uuid not null references public.clientes (id) on delete restrict,
  origen_id              uuid not null references public.ubicaciones (id) on delete restrict,
  destino_id             uuid not null references public.ubicaciones (id) on delete restrict,
  factura                text,
  guia                   text,
  dex                    text,
  tipo_carga             text,
  tonelaje_objetivo      numeric(8, 2),
  etapa                  public.etapa_envio not null default 'programado',  -- se calcula desde las asignaciones
  telefono_coordinador   text,
  notas                  text,
  creado_por             uuid references public.usuarios (id) default auth.uid(),
  creado_en              timestamptz not null default now(),
  actualizado_en         timestamptz not null default now()
);
create trigger misiones_actualizado before update on public.misiones
  for each row execute function public.tocar_actualizado_en();

create table public.misiones_puntos_ruta (
  id            uuid primary key default gen_random_uuid(),
  mision_id     uuid not null references public.misiones (id) on delete cascade,
  ubicacion_id  uuid not null references public.ubicaciones (id) on delete restrict,
  orden         smallint not null,
  unique (mision_id, orden)
);

-- Cada camión dentro de una misión.
create table public.asignaciones (
  id                    uuid primary key default gen_random_uuid(),
  mision_id             uuid not null references public.misiones (id) on delete cascade,
  transportista_id      uuid not null references public.transportistas (id) on delete restrict,
  conductor_id          uuid not null references public.conductores (id) on delete restrict,
  vehiculo_id           uuid not null references public.vehiculos (id) on delete restrict,
  toneladas_cargadas    numeric(8, 2),        -- según la balanza de fábrica
  etapa                 public.etapa_envio not null default 'programado',
  eta_desde             timestamptz,          -- Fase 2
  eta_hasta             timestamptz,          -- Fase 2
  -- Última posición conocida (columnas simples para el mapa en tiempo real).
  ultima_lat            double precision,
  ultima_lon            double precision,
  ultima_velocidad_kmh  smallint,
  ultima_senal          timestamptz,
  frontera_actual_id    uuid references public.ubicaciones (id),
  creado_en             timestamptz not null default now(),
  actualizado_en        timestamptz not null default now()
);
create index asignaciones_mision_idx on public.asignaciones (mision_id);
create index asignaciones_activas_idx on public.asignaciones (etapa) where etapa not in ('entregado', 'cancelado');
create trigger asignaciones_actualizado before update on public.asignaciones
  for each row execute function public.tocar_actualizado_en();

-- ---------------------------------------------------------------------------
-- Acceso del chofer por invitación (código o QR, un viaje, un teléfono)
-- ---------------------------------------------------------------------------
create table public.invitaciones_chofer (
  id              uuid primary key default gen_random_uuid(),
  asignacion_id   uuid not null references public.asignaciones (id) on delete cascade,
  conductor_id    uuid not null references public.conductores (id) on delete cascade,
  codigo          text not null unique,
  vence_en        timestamptz not null,       -- plazo para ACTIVAR; el acceso dura hasta "Entregado"
  usado_por       uuid references auth.users (id) on delete set null,  -- sesión anónima del teléfono
  dispositivo_id  text,
  usado_en        timestamptz,
  revocada        boolean not null default false,
  creado_por      uuid references public.usuarios (id) default auth.uid(),
  creado_en       timestamptz not null default now()
);
create index invitaciones_usado_por_idx on public.invitaciones_chofer (usado_por) where usado_por is not null;

-- Texto de la política de rastreo que acepta el chofer. Se versiona.
create table public.politicas_rastreo (
  version        text primary key,
  texto          text not null,
  vigente        boolean not null default false,
  creado_en      timestamptz not null default now()
);
create unique index politicas_una_vigente on public.politicas_rastreo (vigente) where vigente;

create table public.consentimientos (
  id                uuid primary key default gen_random_uuid(),
  conductor_id      uuid not null references public.conductores (id) on delete cascade,
  auth_user_id      uuid references auth.users (id) on delete set null,
  version_politica  text not null references public.politicas_rastreo (version),
  aceptado_en       timestamptz not null default now()
);
create index consentimientos_conductor_idx on public.consentimientos (conductor_id, version_politica);

-- ---------------------------------------------------------------------------
-- Eventos, documentos, enlaces y avisos
-- ---------------------------------------------------------------------------
create table public.eventos (
  id              uuid primary key default gen_random_uuid(),
  asignacion_id   uuid not null references public.asignaciones (id) on delete cascade,
  tipo            public.tipo_evento not null,
  etapa_nueva     public.etapa_envio,
  foto_ruta       text,             -- Fase 2: ruta en el almacenamiento privado
  ocurrido_en     timestamptz not null default now(),
  origen          public.origen_evento not null,
  detalle         jsonb not null default '{}'::jsonb,
  registrado_por  uuid,             -- usuario o sesión del chofer
  creado_en       timestamptz not null default now()
);
create index eventos_asignacion_idx on public.eventos (asignacion_id, ocurrido_en desc);

create table public.documentos (
  id               uuid primary key default gen_random_uuid(),
  mision_id        uuid not null references public.misiones (id) on delete cascade,
  tipo             public.tipo_documento not null,
  ruta_archivo     text not null,   -- ruta en el bucket privado "documentos"
  nombre_original  text,
  subido_por       uuid references public.usuarios (id) default auth.uid(),
  creado_en        timestamptz not null default now()
);

create table public.enlaces_seguimiento (
  id         uuid primary key default gen_random_uuid(),
  mision_id  uuid not null references public.misiones (id) on delete cascade,
  token      text not null unique default encode(extensions.gen_random_bytes(16), 'hex'),  -- 128 bits
  vence_en   timestamptz not null,
  pin_hash   text,                  -- PIN para documentos (Fase 2), guardado con hash
  estado     public.estado_enlace not null default 'activo',
  creado_en  timestamptz not null default now()
);

create table public.descargas_documentos (
  id            uuid primary key default gen_random_uuid(),
  documento_id  uuid not null references public.documentos (id) on delete cascade,
  enlace_id     uuid references public.enlaces_seguimiento (id) on delete set null,
  ip            inet,
  descargado_en timestamptz not null default now()
);

create table public.avisos (
  id             uuid primary key default gen_random_uuid(),
  mision_id      uuid not null references public.misiones (id) on delete cascade,
  canal          public.canal_aviso not null,
  etapa          public.etapa_envio,
  resultado      text,
  enviado_en     timestamptz not null default now()
);
