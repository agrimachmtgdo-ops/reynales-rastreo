-- =============================================================================
-- Ola 1 · Entrega 2: inspección del camión y precinto en fábrica
-- (plan «Trazabilidad de la carga», aprobado por Ronald el 2026-11-28)
--
--  * Perfil ALMACÉN: rol gerencia (solo lectura) + usuarios.area = 'almacen', igual que
--    comercial. Le abre solo la inspección, los lotes, la balanza y el cierre de carga.
--    No agrega valores al enum rol_personal.
--  * inspecciones_camion: cada inspección del camión del tramo 1 antes de cargar
--    (6 puntos, carga anterior, resultado, motivo y al menos 2 fotos). Si se rechaza,
--    el camión se limpia y se hace otra; ninguna se borra.
--  * asignaciones: inicio de carga (inspección aprobada), fin de carga («Cerrar carga»,
--    exige el precinto) y liberación por excepción del administrador (con motivo).
--  * Bloqueos (decisiones 1 y 2 del plan), con un interruptor para arrancar en modo
--    «solo alerta» (inspeccion_obligatoria = false por defecto, lo cambia el administrador):
--      - sin inspección aprobada no se registran lotes ni balanza;
--      - sin carga cerrada (con precinto) el chofer no puede «Iniciar viaje».
--    El administrador puede liberar un camión por excepción, con motivo.
--    Con el interruptor apagado, el camión sale igual y queda una alerta
--    «sin inspección» o «sin precinto».
--  * Fotos de la inspección en el bucket privado «documentos» (<misión>/insp-…).
--  * rechazos_inspeccion(desde, hasta): inspecciones y rechazos por transportista.
--
-- No borra ni modifica datos existentes. Reversión:
-- supabase/revertir/20261218000100_inspeccion_precinto.sql
-- =============================================================================
set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Interruptor: bloqueo (true) o solo alerta (false)
-- ---------------------------------------------------------------------------
insert into public.configuracion (clave, valor) values ('inspeccion_obligatoria', 'false')
  on conflict (clave) do nothing;

-- ---------------------------------------------------------------------------
-- Perfil almacén
-- ---------------------------------------------------------------------------
alter table public.usuarios drop constraint usuarios_area_check;
alter table public.usuarios add constraint usuarios_area_check
  check (area is null or area in ('comercial', 'almacen'));
comment on column public.usuarios.area is
  'Área de trabajo. ''comercial'' = gerencia + clientes y pedidos; ''almacen'' = gerencia + inspección, lotes, balanza y cierre de carga.';

create or replace function public.es_almacen()
returns boolean language sql stable security definer
set search_path = public as $$
  select exists (select 1 from public.usuarios where id = auth.uid() and activo and area = 'almacen')
$$;

-- Quién registra la carga en fábrica: administrador, logística o almacén.
create or replace function public.puede_cargar()
returns boolean language sql stable security definer
set search_path = public as $$
  select public.puede_editar() or public.es_almacen()
$$;

create or replace function public.perfil_de(p_rol public.rol_personal, p_area text)
returns text language sql immutable
set search_path = public as $$
  select case when p_area in ('comercial', 'almacen') then p_area
              when p_rol = 'despacho' then 'logistica'
              else p_rol::text end
$$;

-- guardar_personal acepta el perfil «almacen» (el resto igual que en 20261209000100).
create or replace function public.guardar_personal(p_usuario uuid, p_nombre text, p_perfil text, p_activo boolean)
returns void language plpgsql security definer
set search_path = public as $$
declare
  v_rol public.rol_personal;
  v_area text;
begin
  if not public.es_administrador() then
    raise exception 'Solo un administrador cambia usuarios.' using errcode = '42501';
  end if;
  if coalesce(trim(p_nombre), '') = '' then
    raise exception 'Escriba el nombre.';
  end if;
  case p_perfil
    when 'administrador' then v_rol := 'administrador'; v_area := null;
    when 'logistica'     then v_rol := 'despacho';      v_area := null;
    when 'gerencia'      then v_rol := 'gerencia';      v_area := null;
    when 'comercial'     then v_rol := 'gerencia';      v_area := 'comercial';
    when 'almacen'       then v_rol := 'gerencia';      v_area := 'almacen';
    else raise exception 'Elija un perfil válido.';
  end case;
  if not exists (select 1 from public.usuarios where id = p_usuario) then
    raise exception 'No existe ese usuario.';
  end if;
  if p_usuario = auth.uid() and (v_rol <> 'administrador' or not p_activo) then
    raise exception 'No puede quitarse a sí mismo el perfil de administrador ni desactivarse. Pídaselo a otro administrador.';
  end if;
  update public.usuarios
     set nombre = trim(p_nombre), rol = v_rol, area = v_area, activo = p_activo
   where id = p_usuario;
  if not exists (select 1 from public.usuarios where rol = 'administrador' and activo) then
    raise exception 'Debe quedar al menos un administrador activo.';
  end if;
  if v_area is distinct from 'comercial' or not p_activo then
    update public.clientes set comercial_id = null where comercial_id = p_usuario;
  end if;
end $$;

-- Lotes y balanza (entrega 1): también los registra almacén. Se cambia SOLO la llamada
-- de permiso (y su mensaje); si el texto esperado no aparece exactamente una vez, la migración se detiene.
do $$
declare
  f text;
  def text;
begin
  foreach f in array array['public.guardar_lote(uuid, uuid, jsonb)', 'public.quitar_lote(uuid)',
                           'public.registrar_balanza(uuid, text, numeric, numeric, numeric)'] loop
    def := pg_get_functiondef(f::regprocedure);
    if (length(def) - length(replace(def, 'if not public.puede_editar() then', ''))) / length('if not public.puede_editar() then') <> 1 then
      raise exception 'No se encontró el permiso esperado en %', f;
    end if;
    execute replace(replace(def, 'if not public.puede_editar() then', 'if not public.puede_cargar() then'),
                    'Solo el administrador o logística', 'Solo almacén, logística o el administrador');
  end loop;
end $$;

-- Fotos de la inspección: almacén también sube al bucket «documentos».
create policy documentos_archivo_subir_almacen on storage.objects for insert to authenticated
  with check (bucket_id = 'documentos' and public.es_almacen());

-- ---------------------------------------------------------------------------
-- Inspección y cierre de carga
-- ---------------------------------------------------------------------------
alter table public.asignaciones
  add column inicio_carga    timestamptz,
  add column fin_carga       timestamptz,
  add column liberado_por    uuid references public.usuarios (id) on delete set null,
  add column liberado_en     timestamptz,
  add column liberado_motivo text check (liberado_motivo is null or length(btrim(liberado_motivo)) between 5 and 300);
comment on column public.asignaciones.inicio_carga is 'Inicio de carga en fábrica (inspección aprobada).';
comment on column public.asignaciones.fin_carga is 'Fin de carga: almacén cerró la carga con el precinto.';
comment on column public.asignaciones.liberado_motivo is 'Excepción del administrador: el camión sale sin inspección aprobada o sin carga cerrada.';

create table public.inspecciones_camion (
  id               uuid primary key default gen_random_uuid(),
  asignacion_id    uuid not null references public.asignaciones (id) on delete cascade,
  inspector_id     uuid references public.usuarios (id) on delete set null default auth.uid(),
  inspector_nombre text,             -- copia del nombre: el resto del personal no lee la tabla usuarios
  realizada_en     timestamptz not null default now(),
  puntos           jsonb not null,
  carga_anterior   text check (carga_anterior is null or length(btrim(carga_anterior)) <= 120),
  resultado        text not null check (resultado in ('aprobado', 'rechazado')),
  motivo           text check (motivo is null or length(btrim(motivo)) <= 300),
  fotos            text[] not null default '{}',
  constraint inspecciones_motivo_rechazo check (resultado = 'aprobado' or length(btrim(coalesce(motivo, ''))) >= 5)
);
create index inspecciones_asignacion_idx on public.inspecciones_camion (asignacion_id, realizada_en desc);
comment on table public.inspecciones_camion is 'Inspección del camión antes de cargar (almacén). Se escribe solo con registrar_inspeccion.';

alter table public.inspecciones_camion enable row level security;
create policy inspecciones_leer on public.inspecciones_camion for select to authenticated using (public.es_personal());
revoke all on public.inspecciones_camion from anon;
revoke insert, update, delete on public.inspecciones_camion from authenticated;

-- Los 6 puntos de la lista (clave → texto que ve almacén).
create or replace function public.puntos_inspeccion()
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'piso_limpio_seco',   'Piso limpio y seco',
    'sin_olores',         'Sin olores extraños',
    'sin_plagas_restos',  'Sin insectos ni restos de carga',
    'carroceria_sana',    'Carrocería sin huecos ni clavos salientes',
    'lona_buena',         'Lona o carpa sin roturas',
    'carga_compatible',   'Carga anterior compatible (no químicos, fertilizantes ni combustibles)')
$$;

-- ¿Inspección aprobada vigente? (la última inspección del camión está aprobada)
create or replace function public.inspeccion_aprobada(p_asignacion uuid)
returns boolean language sql stable security definer
set search_path = public as $$
  select coalesce((select resultado = 'aprobado' from public.inspecciones_camion
                    where asignacion_id = p_asignacion order by realizada_en desc limit 1), false)
$$;

create or replace function public.inspeccion_obligatoria()
returns boolean language sql stable security definer
set search_path = public as $$
  select coalesce((select (valor #>> '{}')::boolean from public.configuracion where clave = 'inspeccion_obligatoria'), false)
$$;

-- Registrar una inspección. p_puntos: {clave: true|false} con las 6 claves.
create or replace function public.registrar_inspeccion(
  p_asignacion uuid, p_puntos jsonb, p_carga_anterior text, p_resultado text, p_motivo text, p_fotos text[]
) returns uuid language plpgsql security definer
set search_path = public as $$
declare
  a public.asignaciones;
  v_id uuid;
  v_falla text[];
  k text;
  v_fotos text[] := coalesce(p_fotos, '{}');
begin
  if not public.puede_cargar() then
    raise exception 'Solo almacén, logística o el administrador registran la inspección.' using errcode = '42501';
  end if;
  select * into a from public.asignaciones where id = p_asignacion for update;
  if a.id is null then raise exception 'No existe ese camión.'; end if;
  if coalesce(a.tramo, 1) <> 1 then raise exception 'La inspección es del camión que carga en fábrica (tramo 1).'; end if;
  if a.etapa <> 'programado' then raise exception 'El camión ya salió de fábrica: no se puede inspeccionar.'; end if;
  if a.fin_carga is not null then raise exception 'La carga de este camión ya está cerrada.'; end if;
  if coalesce(p_resultado, '') not in ('aprobado', 'rechazado') then raise exception 'Indique si el camión se aprueba o se rechaza.'; end if;
  if coalesce(jsonb_typeof(p_puntos), '') <> 'object' then raise exception 'Marque los puntos de la inspección.'; end if;
  for k in select jsonb_object_keys(public.puntos_inspeccion()) loop
    if coalesce(jsonb_typeof(p_puntos -> k), '') <> 'boolean' then
      raise exception 'Falta revisar: %.', public.puntos_inspeccion() ->> k;
    end if;
    if not (p_puntos ->> k)::boolean then v_falla := v_falla || (public.puntos_inspeccion() ->> k); end if;
  end loop;
  if p_resultado = 'aprobado' and v_falla is not null then
    raise exception 'No se puede aprobar: no cumple «%».', array_to_string(v_falla, '», «');
  end if;
  if p_resultado = 'rechazado' and length(btrim(coalesce(p_motivo, ''))) < 5 then
    raise exception 'Escriba el motivo del rechazo.';
  end if;
  if cardinality(v_fotos) < 2 then
    raise exception 'Agregue al menos 2 fotos: interior de la carrocería y lona.';
  end if;
  if exists (select 1 from unnest(v_fotos) r where r not like a.mision_id::text || '/insp-%') then
    raise exception 'Fotos no válidas para este camión.';
  end if;

  insert into public.inspecciones_camion (asignacion_id, inspector_nombre, puntos, carga_anterior, resultado, motivo, fotos)
  values (p_asignacion, (select nombre from public.usuarios where id = auth.uid()), p_puntos, nullif(btrim(coalesce(p_carga_anterior, '')), ''), p_resultado,
          nullif(btrim(coalesce(p_motivo, '')), ''), v_fotos)
  returning id into v_id;
  if p_resultado = 'aprobado' then
    update public.asignaciones set inicio_carga = coalesce(inicio_carga, now()) where id = p_asignacion;
  end if;
  insert into public.eventos (asignacion_id, tipo, origen, detalle, registrado_por)
  values (p_asignacion, case when p_resultado = 'aprobado' then 'nota' else 'incidencia' end::public.tipo_evento, 'despacho',
          jsonb_build_object('accion', 'inspeccion_' || p_resultado, 'motivo_rechazo', nullif(btrim(coalesce(p_motivo, '')), ''),
                             'falla', to_jsonb(v_falla), 'carga_anterior', nullif(btrim(coalesce(p_carga_anterior, '')), '')),
          auth.uid());
  return v_id;
end $$;

-- Cerrar la carga: exige inspección aprobada (o liberación) y el precinto.
create or replace function public.cerrar_carga(p_asignacion uuid, p_precinto text)
returns void language plpgsql security definer
set search_path = public as $$
declare a public.asignaciones; v_precinto text := upper(btrim(coalesce(p_precinto, '')));
begin
  if not public.puede_cargar() then
    raise exception 'Solo almacén, logística o el administrador cierran la carga.' using errcode = '42501';
  end if;
  select * into a from public.asignaciones where id = p_asignacion for update;
  if a.id is null then raise exception 'No existe ese camión.'; end if;
  if coalesce(a.tramo, 1) <> 1 then raise exception 'El cierre de carga es del camión que sale de fábrica (tramo 1).'; end if;
  if a.etapa = 'cancelado' then raise exception 'El camión está cancelado.'; end if;
  if not public.inspeccion_aprobada(p_asignacion) and a.liberado_en is null then
    raise exception 'Primero apruebe la inspección del camión.';
  end if;
  if v_precinto = '' then raise exception 'Escriba el número de precinto.'; end if;
  if length(v_precinto) > 60 then raise exception 'El precinto tiene hasta 60 caracteres.'; end if;
  update public.asignaciones
     set precinto = v_precinto, fin_carga = coalesce(fin_carga, now()), inicio_carga = coalesce(inicio_carga, now())
   where id = p_asignacion;
  insert into public.eventos (asignacion_id, tipo, origen, detalle, registrado_por)
  values (p_asignacion, 'nota', 'despacho',
          jsonb_build_object('accion', case when a.fin_carga is null then 'carga_cerrada' else 'precinto_corregido' end,
                             'precinto', v_precinto, 'precinto_anterior', a.precinto),
          auth.uid());
end $$;

-- Excepción: el administrador libera un camión (sale sin inspección aprobada o sin carga cerrada).
create or replace function public.liberar_camion(p_asignacion uuid, p_motivo text)
returns void language plpgsql security definer
set search_path = public as $$
declare a public.asignaciones;
begin
  if not public.es_administrador() then
    raise exception 'Solo el administrador libera un camión por excepción.' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_motivo, ''))) < 5 then raise exception 'Escriba el motivo de la excepción.'; end if;
  select * into a from public.asignaciones where id = p_asignacion for update;
  if a.id is null then raise exception 'No existe ese camión.'; end if;
  if coalesce(a.tramo, 1) <> 1 or a.etapa <> 'programado' then
    raise exception 'Solo se libera un camión del tramo 1 que aún no salió.';
  end if;
  update public.asignaciones
     set liberado_por = auth.uid(), liberado_en = now(), liberado_motivo = btrim(p_motivo)
   where id = p_asignacion;
  insert into public.eventos (asignacion_id, tipo, origen, detalle, registrado_por)
  values (p_asignacion, 'incidencia', 'despacho',
          jsonb_build_object('motivo', 'liberado_por_excepcion', 'nota', btrim(p_motivo)), auth.uid());
end $$;

-- ---------------------------------------------------------------------------
-- Bloqueos (con el interruptor encendido) y alertas (con el interruptor apagado)
-- ---------------------------------------------------------------------------
-- Lotes: sin inspección aprobada (ni liberación) no se registran.
create or replace function public.trg_lote_requiere_inspeccion()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  if public.inspeccion_obligatoria() and not public.inspeccion_aprobada(new.asignacion_id)
     and not exists (select 1 from public.asignaciones where id = new.asignacion_id and liberado_en is not null) then
    raise exception 'El camión no tiene la inspección aprobada: no se puede cargar. Inspecciónelo o pida al administrador que lo libere.';
  end if;
  return new;
end $$;
create trigger cargas_lote_inspeccion before insert on public.cargas_lote
  for each row execute function public.trg_lote_requiere_inspeccion();

-- Balanza (ticket, bruto, tara o neto): igual.
create or replace function public.trg_balanza_requiere_inspeccion()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  if coalesce(new.tramo, 1) = 1 and public.inspeccion_obligatoria()
     and new.liberado_en is null and not public.inspeccion_aprobada(new.id)
     and (new.peso_bruto_kg, new.tara_kg, new.ticket_balanza, new.toneladas_cargadas)
         is distinct from (old.peso_bruto_kg, old.tara_kg, old.ticket_balanza, old.toneladas_cargadas) then
    raise exception 'El camión no tiene la inspección aprobada: no se puede registrar la balanza. Inspecciónelo o pida al administrador que lo libere.';
  end if;
  return new;
end $$;
create trigger asignaciones_balanza_inspeccion
  before update of peso_bruto_kg, tara_kg, ticket_balanza, toneladas_cargadas on public.asignaciones
  for each row execute function public.trg_balanza_requiere_inspeccion();

-- Salida: sin carga cerrada no se inicia el viaje (bloqueo) o queda alerta (modo alerta).
create or replace function public.trg_salida_requiere_carga_cerrada()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  if coalesce(new.tramo, 1) = 1 and old.etapa = 'programado'
     and new.etapa in ('cargado', 'en_ruta', 'en_frontera', 'cruzo_frontera', 'entregado')
     and new.fin_carga is null and new.liberado_en is null
     and public.inspeccion_obligatoria() then
    raise exception 'La carga de este camión aún no está cerrada por almacén (inspección y precinto). Avise a despacho.';
  end if;
  return new;
end $$;
create trigger asignaciones_salida_carga_cerrada
  before update of etapa on public.asignaciones
  for each row execute function public.trg_salida_requiere_carga_cerrada();

create or replace function public.trg_alerta_salida_sin_inspeccion()
returns trigger language plpgsql security definer
set search_path = public as $$
declare v_faltan text[];
begin
  if coalesce(new.tramo, 1) <> 1 or old.etapa <> 'programado'
     or new.etapa not in ('cargado', 'en_ruta', 'en_frontera', 'cruzo_frontera', 'entregado')
     or new.liberado_en is not null then
    return new;
  end if;
  if not public.inspeccion_aprobada(new.id) then v_faltan := v_faltan || 'inspeccion'::text; end if;
  if new.fin_carga is null or new.precinto is null then v_faltan := v_faltan || 'precinto'::text; end if;
  if v_faltan is not null then
    insert into public.eventos (asignacion_id, tipo, origen, detalle)
    values (new.id, 'incidencia', 'sistema', jsonb_build_object('motivo', 'salio_sin_inspeccion', 'faltan', to_jsonb(v_faltan)));
  end if;
  return new;
end $$;
create trigger asignaciones_alerta_sin_inspeccion
  after update of etapa on public.asignaciones
  for each row execute function public.trg_alerta_salida_sin_inspeccion();

-- ---------------------------------------------------------------------------
-- Interruptor (solo administrador)
-- ---------------------------------------------------------------------------
create or replace function public.fijar_inspeccion_obligatoria(p_valor boolean)
returns void language plpgsql security definer
set search_path = public as $$
begin
  if not public.es_administrador() then
    raise exception 'Solo el administrador cambia este ajuste.' using errcode = '42501';
  end if;
  insert into public.configuracion (clave, valor, actualizado_en) values ('inspeccion_obligatoria', to_jsonb(coalesce(p_valor, false)), now())
  on conflict (clave) do update set valor = excluded.valor, actualizado_en = now();
end $$;

-- ---------------------------------------------------------------------------
-- Cumplimiento: inspecciones y rechazos por transportista (solo lectura)
-- ---------------------------------------------------------------------------
create or replace function public.rechazos_inspeccion(p_desde date, p_hasta date)
returns table (transportista_id uuid, transportista text, camiones_inspeccionados bigint, camiones_rechazados bigint, rechazos bigint)
language plpgsql stable security definer
set search_path = public as $$
begin
  if not public.es_personal() then raise exception 'Sin permiso.' using errcode = '42501'; end if;
  return query
    select t.id, t.razon_social,
           count(distinct i.asignacion_id),
           count(distinct i.asignacion_id) filter (where i.resultado = 'rechazado'),
           count(*) filter (where i.resultado = 'rechazado')
      from public.inspecciones_camion i
      join public.asignaciones a on a.id = i.asignacion_id
      join public.transportistas t on t.id = a.transportista_id
     where (i.realizada_en at time zone 'America/La_Paz')::date between coalesce(p_desde, '2000-01-01') and coalesce(p_hasta, '2100-01-01')
     group by t.id, t.razon_social
     order by 4 desc, 2;
end $$;

-- ---------------------------------------------------------------------------
-- Permisos de ejecución
-- ---------------------------------------------------------------------------
revoke execute on function public.trg_lote_requiere_inspeccion(), public.trg_balanza_requiere_inspeccion(),
  public.trg_salida_requiere_carga_cerrada(), public.trg_alerta_salida_sin_inspeccion()
  from public, anon, authenticated;
revoke execute on function public.es_almacen(), public.puede_cargar(), public.inspeccion_aprobada(uuid),
  public.inspeccion_obligatoria(), public.registrar_inspeccion(uuid, jsonb, text, text, text, text[]),
  public.cerrar_carga(uuid, text), public.liberar_camion(uuid, text), public.fijar_inspeccion_obligatoria(boolean),
  public.rechazos_inspeccion(date, date)
  from public, anon;
grant execute on function public.es_almacen(), public.puede_cargar(), public.inspeccion_aprobada(uuid),
  public.inspeccion_obligatoria(), public.puntos_inspeccion(), public.registrar_inspeccion(uuid, jsonb, text, text, text, text[]),
  public.cerrar_carga(uuid, text), public.liberar_camion(uuid, text), public.fijar_inspeccion_obligatoria(boolean),
  public.rechazos_inspeccion(date, date)
  to authenticated;
