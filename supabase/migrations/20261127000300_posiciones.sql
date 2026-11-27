-- =============================================================================
-- 3. Posiciones GPS (tabla particionada por mes)
-- =============================================================================
set search_path = public, extensions;

create table public.posiciones (
  asignacion_id  uuid not null references public.asignaciones (id) on delete cascade,
  capturado_en   timestamptz not null,           -- hora en el teléfono
  recibido_en    timestamptz not null default now(),
  punto          extensions.geography(Point, 4326) not null,
  velocidad_kmh  smallint,
  precision_m    smallint,
  simulada       boolean not null default false,  -- Android marcó la ubicación como falsa
  -- Evita duplicados si el teléfono reenvía el mismo lote.
  primary key (asignacion_id, capturado_en)
) partition by range (capturado_en);

comment on table public.posiciones is
  'Historial GPS por camión. Particionada por mes para borrar meses antiguos (retención 6 a 12 meses) sin afectar al resto.';

-- Las particiones son tablas reales: la API de Supabase podría exponerlas directamente.
-- Por eso cada partición se cierra (RLS activo sin políticas y sin permisos para la API);
-- los datos se leen solo a través de la tabla "posiciones", que sí tiene RLS.
create or replace function public.cerrar_particion(p_tabla text)
returns void language plpgsql
set search_path = public as $$
begin
  execute format('alter table public.%I enable row level security', p_tabla);
  execute format('revoke all on public.%I from public, anon, authenticated', p_tabla);
end $$;

-- Partición "por defecto" por si llega una fecha fuera de rango.
create table public.posiciones_default partition of public.posiciones default;
select public.cerrar_particion('posiciones_default');

-- Crea las particiones mensuales que falten. Puede ejecutarse muchas veces sin problema.
create or replace function public.crear_particiones_posiciones(p_desde date, p_meses int)
returns int language plpgsql
set search_path = public, extensions as $$
declare
  inicio date := date_trunc('month', p_desde)::date;
  creadas int := 0;
  nombre text;
begin
  for i in 0 .. p_meses - 1 loop
    nombre := 'posiciones_' || to_char(inicio + make_interval(months => i), 'YYYY_MM');
    if to_regclass('public.' || nombre) is null then
      execute format(
        'create table public.%I partition of public.posiciones for values from (%L) to (%L)',
        nombre, inicio + make_interval(months => i), inicio + make_interval(months => i + 1)
      );
      perform public.cerrar_particion(nombre);
      creadas := creadas + 1;
    end if;
  end loop;
  return creadas;
end $$;

-- Dos años de particiones desde noviembre de 2026.
select public.crear_particiones_posiciones('2026-11-01', 24);

create index posiciones_punto_idx on public.posiciones using gist (punto);
