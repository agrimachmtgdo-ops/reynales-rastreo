-- =============================================================================
-- Ola 1 · Entrega 3: documentos y requisitos por cliente y destino
-- (plan «Trazabilidad de la carga», aprobado por Ronald el 2026-11-28)
--
--  * Documentos nuevos como tipo «otro» + etiqueta (igual que la lista de empaque;
--    el enum tipo_documento no se toca): fitosanitario, certificado de análisis,
--    ticket de balanza, guía firmada, booking y BL.
--  * requisitos_documentos: qué documento se exige, en qué momento (salida de
--    fábrica, salida del transbordo, entrega, embarque) y a quién (todos, envíos
--    fuera de Bolivia, un país de destino o un cliente). Un cliente también puede
--    marcar un documento general como «no requerido».
--  * Reglas iniciales = las de hoy: factura siempre; DEX fuera de Bolivia; CRT y
--    MIC/DTA en los camiones del transbordo fuera de Bolivia. Se agrega la guía
--    firmada en la entrega para todos.
--  * expediente_mision(misión): la lista de documentos exigidos con lo que hay y lo
--    que falta (por camión cuando el documento es de cada camión).
--  * Las alertas de documentos faltantes (salida de fábrica y del transbordo) pasan
--    a leer esta tabla.
--
-- No borra ni modifica datos existentes. Reversión:
-- supabase/revertir/20261219000100_requisitos_documentos.sql
-- =============================================================================
set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Etiquetas nuevas (tipo «otro»)
-- ---------------------------------------------------------------------------
alter table public.documentos drop constraint documentos_etiqueta_valida;
alter table public.documentos add constraint documentos_etiqueta_valida check (
  etiqueta is null or (tipo = 'otro' and etiqueta in (
    'lista_empaque', 'fitosanitario', 'certificado_analisis', 'ticket_balanza', 'guia_firmada', 'booking', 'bl')));

-- Clave que ve el usuario: el tipo, o la etiqueta si es un «otro» etiquetado.
create or replace function public.clave_documento(p_tipo public.tipo_documento, p_etiqueta text)
returns text language sql immutable
set search_path = public as $$
  select case when p_tipo = 'otro' and p_etiqueta is not null then p_etiqueta else p_tipo::text end
$$;

-- Momento en que se pide cada documento.
create or replace function public.momento_documento(p_documento text)
returns text language sql immutable as $$
  select case
    when p_documento in ('crt', 'mic_dta') then 'salida_transbordo'
    when p_documento = 'guia_firmada' then 'entrega'
    when p_documento in ('booking', 'bl') then 'embarque'
    else 'salida_fabrica' end
$$;

-- Documentos que lleva cada camión (los demás son de toda la misión).
create or replace function public.documento_por_camion(p_documento text)
returns boolean language sql immutable as $$
  select p_documento in ('crt', 'mic_dta', 'ticket_balanza', 'guia_firmada')
$$;

-- ---------------------------------------------------------------------------
-- Requisitos
-- ---------------------------------------------------------------------------
create table public.requisitos_documentos (
  id              uuid primary key default gen_random_uuid(),
  documento       text not null check (documento in (
                    'factura', 'dex', 'guia', 'certificado_origen', 'lista_empaque', 'crt', 'mic_dta',
                    'fitosanitario', 'certificado_analisis', 'ticket_balanza', 'guia_firmada', 'booking', 'bl')),
  momento         text not null check (momento in ('salida_fabrica', 'salida_transbordo', 'entrega', 'embarque')),
  alcance         text not null check (alcance in ('todos', 'internacional', 'pais', 'cliente')),
  pais            text check (pais is null or pais ~ '^[A-Z]{2}$'),
  cliente_id      uuid references public.clientes (id) on delete cascade,
  requerido       boolean not null default true,
  activo          boolean not null default true,
  actualizado_por uuid references public.usuarios (id) on delete set null default auth.uid(),
  actualizado_en  timestamptz not null default now(),
  constraint requisitos_pais_alcance check ((alcance = 'pais') = (pais is not null)),
  constraint requisitos_cliente_alcance check ((alcance = 'cliente') = (cliente_id is not null)),
  constraint requisitos_no_requerido_cliente check (requerido or alcance = 'cliente')
);
create unique index requisitos_documentos_unico on public.requisitos_documentos
  (documento, momento, alcance, coalesce(pais, ''), coalesce(cliente_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index requisitos_documentos_cliente_idx on public.requisitos_documentos (cliente_id) where cliente_id is not null;
comment on table public.requisitos_documentos is
  'Documentos exigidos por momento y alcance (todos, fuera de Bolivia, país o cliente). Se escribe solo con fijar_requisito_cliente y guardar_requisito_general.';

alter table public.requisitos_documentos enable row level security;
create policy requisitos_leer on public.requisitos_documentos for select to authenticated using (public.es_personal());
revoke all on public.requisitos_documentos from anon;
revoke insert, update, delete on public.requisitos_documentos from authenticated;

insert into public.requisitos_documentos (documento, momento, alcance, actualizado_por) values
  ('factura',      'salida_fabrica',    'todos',         null),
  ('dex',          'salida_fabrica',    'internacional', null),
  ('crt',          'salida_transbordo', 'internacional', null),
  ('mic_dta',      'salida_transbordo', 'internacional', null),
  ('guia_firmada', 'entrega',           'todos',         null);

-- Requisitos que valen para una misión (generales + del cliente − «no requerido» del cliente).
create or replace function public.requisitos_de_mision(p_mision uuid)
returns table (documento text, momento text)
language sql stable security definer
set search_path = public as $$
  with m as (
    select mi.cliente_id, coalesce(u.pais, 'BO') as pais
      from public.misiones mi left join public.ubicaciones u on u.id = mi.destino_id
     where mi.id = p_mision
  )
  select r.documento, r.momento
    from public.requisitos_documentos r, m
   where r.activo and r.requerido
     and (r.alcance = 'todos'
          or (r.alcance = 'internacional' and m.pais <> 'BO')
          or (r.alcance = 'pais' and r.pais = m.pais)
          or (r.alcance = 'cliente' and r.cliente_id = m.cliente_id))
  except
  select r.documento, r.momento
    from public.requisitos_documentos r, m
   where r.activo and not r.requerido and r.alcance = 'cliente' and r.cliente_id = m.cliente_id
$$;

-- Expediente de la misión: cada documento exigido, por camión cuando corresponde, y si ya está.
-- Camiones por momento: salida de fábrica → tramo 1; salida del transbordo → tramos 2 y 3;
-- entrega → el último tramo. Un documento de toda la misión cuenta para todos sus camiones.
create or replace function public.expediente_calcular(p_mision uuid)
returns table (documento text, momento text, asignacion_id uuid, placa text, tiene boolean)
language sql stable security definer
set search_path = public as $$
  with req as (select * from public.requisitos_de_mision(p_mision)),
  cam as (
    select a.id, a.tramo, v.placa
      from public.asignaciones a left join public.vehiculos v on v.id = a.vehiculo_id
     where a.mision_id = p_mision and a.etapa <> 'cancelado'
  ),
  ultimo as (select max(coalesce(tramo, 1)) as t from cam),
  docs as (
    select public.clave_documento(d.tipo, d.etiqueta) as clave, d.asignacion_id
      from public.documentos d
     where d.mision_id = p_mision and d.reemplazado_por is null
  ),
  items as (
    -- Documentos de cada camión, con camiones en ese momento.
    select r.documento, r.momento, c.id as asignacion_id, c.placa
      from req r join cam c on public.documento_por_camion(r.documento)
       and ((r.momento = 'salida_fabrica' and coalesce(c.tramo, 1) = 1)
            or (r.momento = 'salida_transbordo' and coalesce(c.tramo, 1) > 1)
            or (r.momento = 'entrega' and coalesce(c.tramo, 1) = (select t from ultimo)))
    union all
    -- Documentos de toda la misión, o de cada camión cuando aún no hay camiones en ese momento
    -- (salvo la salida del transbordo, que solo existe si hay transbordo).
    select r.documento, r.momento, null::uuid, null::text
      from req r
     where not public.documento_por_camion(r.documento)
        or (r.momento <> 'salida_transbordo'
            and not exists (select 1 from cam c
                             where (r.momento = 'salida_fabrica' and coalesce(c.tramo, 1) = 1)
                                or (r.momento = 'entrega' and coalesce(c.tramo, 1) = (select t from ultimo))
                                or r.momento = 'embarque'))
  )
  select i.documento, i.momento, i.asignacion_id, i.placa,
         exists (select 1 from docs d where d.clave = i.documento
                   and (i.asignacion_id is null or d.asignacion_id is null or d.asignacion_id = i.asignacion_id))
    from items i
$$;

create or replace function public.expediente_mision(p_mision uuid)
returns table (documento text, momento text, asignacion_id uuid, placa text, tiene boolean)
language plpgsql stable security definer
set search_path = public as $$
begin
  if not public.es_personal() and public.operador_tramo_de(p_mision) is null then
    raise exception 'Sin permiso.' using errcode = '42501';
  end if;
  return query
    select e.* from public.expediente_calcular(p_mision) e
     order by case e.momento when 'salida_fabrica' then 1 when 'salida_transbordo' then 2 when 'entrega' then 3 else 4 end,
              e.documento, e.placa nulls first;
end $$;

-- ---------------------------------------------------------------------------
-- Cambios de requisitos
-- ---------------------------------------------------------------------------
-- Un cliente exige un documento ('exige'), no lo requiere ('no_requerido') o sigue la regla general (null).
create or replace function public.fijar_requisito_cliente(p_cliente uuid, p_documento text, p_estado text)
returns void language plpgsql security definer
set search_path = public as $$
begin
  if not (public.puede_editar() or public.es_comercial()) then
    raise exception 'Solo el administrador, logística o comercial cambian los documentos de un cliente.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.clientes where id = p_cliente) then
    raise exception 'No existe ese cliente.';
  end if;
  if p_estado is not null and p_estado not in ('exige', 'no_requerido') then
    raise exception 'Elija si el cliente exige el documento o no lo requiere.';
  end if;
  delete from public.requisitos_documentos where alcance = 'cliente' and cliente_id = p_cliente and documento = p_documento;
  if p_estado is not null then
    insert into public.requisitos_documentos (documento, momento, alcance, cliente_id, requerido)
    values (p_documento, public.momento_documento(p_documento), 'cliente', p_cliente, p_estado = 'exige');
  end if;
end $$;

-- ADMINISTRADOR: regla general (todos, fuera de Bolivia o un país), activa o no.
create or replace function public.guardar_requisito_general(p_documento text, p_alcance text, p_pais text, p_activo boolean)
returns void language plpgsql security definer
set search_path = public as $$
declare v_pais text := nullif(upper(btrim(coalesce(p_pais, ''))), '');
begin
  if not public.es_administrador() then
    raise exception 'Solo el administrador cambia las reglas generales de documentos.' using errcode = '42501';
  end if;
  if p_alcance not in ('todos', 'internacional', 'pais') then
    raise exception 'Elija a quién se exige: todos, fuera de Bolivia o un país.';
  end if;
  if p_alcance = 'pais' and v_pais is null then raise exception 'Elija el país.'; end if;
  if p_alcance <> 'pais' then v_pais := null; end if;
  insert into public.requisitos_documentos (documento, momento, alcance, pais, activo)
  values (p_documento, public.momento_documento(p_documento), p_alcance, v_pais, coalesce(p_activo, true))
  on conflict (documento, momento, alcance, coalesce(pais, ''), coalesce(cliente_id, '00000000-0000-0000-0000-000000000000'::uuid))
  do update set activo = excluded.activo, actualizado_por = auth.uid(), actualizado_en = now();
end $$;

-- ---------------------------------------------------------------------------
-- Alertas de documentos faltantes: leen los requisitos
-- ---------------------------------------------------------------------------
-- Salida de fábrica (primer camión del tramo 1; una sola alerta por misión).
create or replace function public.trg_documentos_carga()
returns trigger language plpgsql security definer
set search_path = public as $$
declare
  faltan text[];
begin
  if coalesce(new.tramo, 1) <> 1 or old.etapa <> 'programado'
     or new.etapa not in ('cargado', 'en_ruta', 'en_frontera', 'cruzo_frontera') then
    return new;
  end if;
  if exists (select 1 from public.eventos e join public.asignaciones a on a.id = e.asignacion_id
              where a.mision_id = new.mision_id and e.tipo = 'incidencia'
                and e.detalle ->> 'motivo' = 'sin_documentos_carga') then
    return new;
  end if;
  select array_agg(distinct e.documento order by e.documento) into faltan
    from public.expediente_calcular(new.mision_id) e
   where e.momento = 'salida_fabrica' and not e.tiene
     and (e.asignacion_id is null or e.asignacion_id = new.id);
  if faltan is not null then
    insert into public.eventos (asignacion_id, tipo, origen, detalle)
    values (new.id, 'incidencia', 'sistema',
            jsonb_build_object('motivo', 'sin_documentos_carga', 'faltan', to_jsonb(faltan)));
  end if;
  return new;
end $$;

-- Salida del transbordo (cada camión de los tramos 2 y 3).
create or replace function public.trg_documentos_salida()
returns trigger language plpgsql security definer
set search_path = public as $$
declare
  faltan text[];
begin
  if new.tramo > 1 and old.etapa in ('programado', 'cargado')
     and new.etapa in ('en_ruta', 'en_frontera', 'cruzo_frontera') then
    select array_agg(distinct e.documento order by e.documento) into faltan
      from public.expediente_calcular(new.mision_id) e
     where e.momento = 'salida_transbordo' and not e.tiene and e.asignacion_id = new.id;
    if faltan is not null then
      insert into public.eventos (asignacion_id, tipo, origen, detalle)
      values (new.id, 'incidencia', 'sistema',
              jsonb_build_object('motivo', 'sin_documentos_transbordo', 'faltan', to_jsonb(faltan)));
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Permisos de ejecución
-- ---------------------------------------------------------------------------
revoke execute on function public.requisitos_de_mision(uuid), public.expediente_calcular(uuid)
  from public, anon, authenticated;
revoke execute on function public.expediente_mision(uuid), public.fijar_requisito_cliente(uuid, text, text),
  public.guardar_requisito_general(text, text, text, boolean)
  from public, anon;
grant execute on function public.expediente_mision(uuid), public.fijar_requisito_cliente(uuid, text, text),
  public.guardar_requisito_general(text, text, text, boolean), public.clave_documento(public.tipo_documento, text),
  public.momento_documento(text), public.documento_por_camion(text)
  to authenticated;
