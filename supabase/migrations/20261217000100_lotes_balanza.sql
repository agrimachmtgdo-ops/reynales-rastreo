-- =============================================================================
-- Ola 1 · Entrega 1: lotes de producción y ticket de balanza por camión
-- (plan «Trazabilidad de la carga», aprobado por Ronald el 2026-11-28)
--
--  * cargas_lote: qué lleva cada camión del tramo 1 (el que sale de fábrica):
--    producto del catálogo, número de lote, fecha de producción, presentación
--    (saco de 50 kg, saco de 40 kg, big bag de 1.200 kg o granel), unidades y kg.
--    Un camión puede llevar varios lotes. En sacos y big bags los kg se calculan
--    con el peso nominal; en granel se escribe el peso.
--  * asignaciones: número de ticket de balanza, peso bruto y tara (kg). Si se
--    escriben bruto y tara, las toneladas cargadas pasan a ser el neto. Si solo se
--    escribe el neto (como hasta hoy), se acepta igual.
--  * asignaciones.kg_lotes: suma de los lotes del camión (la mantiene un disparador),
--    para mostrar «Sin lotes» y la diferencia con la balanza sin otra consulta.
--  * buscar_lote(texto): a qué camiones, misiones, clientes y pedidos fue un lote.
--  * Parámetro lotes_tolerancia_pct (0,5 %): diferencia aceptada entre lotes y balanza.
--  * Escriben lotes y balanza: administrador y logística (puede_editar()).
--    El perfil almacén se agrega en la entrega 2.
--
-- No borra ni modifica datos existentes. No agrega valores a ningún enum.
-- Reversión: supabase/revertir/20261217000100_lotes_balanza.sql
-- =============================================================================
set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Parámetro
-- ---------------------------------------------------------------------------
insert into public.configuracion (clave, valor) values ('lotes_tolerancia_pct', '0.5')
  on conflict (clave) do nothing;

-- ---------------------------------------------------------------------------
-- Ticket de balanza en el camión
-- ---------------------------------------------------------------------------
alter table public.asignaciones
  add column ticket_balanza text check (ticket_balanza is null or length(btrim(ticket_balanza)) between 1 and 40),
  add column peso_bruto_kg  numeric(9, 1) check (peso_bruto_kg is null or peso_bruto_kg between 1 and 80000),
  add column tara_kg        numeric(9, 1) check (tara_kg is null or tara_kg between 1 and 40000),
  add column kg_lotes       numeric(10, 1),
  add constraint asignaciones_bruto_mayor_tara check (peso_bruto_kg is null or tara_kg is null or peso_bruto_kg > tara_kg);
comment on column public.asignaciones.ticket_balanza is 'Número del ticket de balanza de fábrica (tramo 1).';
comment on column public.asignaciones.peso_bruto_kg is 'Peso bruto de balanza en kg (camión cargado).';
comment on column public.asignaciones.tara_kg is 'Tara en kg (camión vacío). Neto = bruto − tara = toneladas_cargadas × 1000.';
comment on column public.asignaciones.kg_lotes is 'Suma de kg de los lotes del camión (calculada). NULL = sin lotes registrados.';

-- Con bruto y tara, las toneladas cargadas son el neto (redondeado a 0,01 t).
create or replace function public.trg_neto_balanza()
returns trigger language plpgsql
set search_path = public as $$
begin
  if new.peso_bruto_kg is not null and new.tara_kg is not null
     and (tg_op = 'INSERT' or new.peso_bruto_kg is distinct from old.peso_bruto_kg
          or new.tara_kg is distinct from old.tara_kg) then
    new.toneladas_cargadas := round((new.peso_bruto_kg - new.tara_kg) / 1000.0, 2);
  end if;
  return new;
end $$;
create trigger asignaciones_neto_balanza
  before insert or update of peso_bruto_kg, tara_kg on public.asignaciones
  for each row execute function public.trg_neto_balanza();

-- ---------------------------------------------------------------------------
-- Lotes por camión
-- ---------------------------------------------------------------------------
create table public.cargas_lote (
  id                uuid primary key default gen_random_uuid(),
  asignacion_id     uuid not null references public.asignaciones (id) on delete cascade,
  producto_id       uuid not null references public.productos (id) on delete restrict,
  lote              text not null check (lote ~ '^[A-Z0-9][A-Z0-9./-]{0,39}$'),
  fecha_produccion  date,
  presentacion      text not null check (presentacion in ('saco_50', 'saco_40', 'big_bag_1200', 'granel')),
  unidades          integer check (unidades is null or unidades between 1 and 5000),
  kg                numeric(10, 1) not null check (kg > 0 and kg <= 60000),
  registrado_por    uuid references public.usuarios (id) on delete set null default auth.uid(),
  creado_en         timestamptz not null default now(),
  -- En sacos y big bags se cuentan unidades; en granel no.
  constraint cargas_lote_unidades check ((presentacion = 'granel') = (unidades is null)),
  unique (asignacion_id, producto_id, lote, presentacion)
);
create index cargas_lote_asignacion_idx on public.cargas_lote (asignacion_id);
create index cargas_lote_lote_idx on public.cargas_lote (lote text_pattern_ops);
comment on table public.cargas_lote is 'Lotes de producción que lleva cada camión del tramo 1. Se escribe solo con guardar_lote y quitar_lote.';

alter table public.cargas_lote enable row level security;
create policy cargas_lote_leer on public.cargas_lote for select to authenticated using (public.es_personal());
revoke all on public.cargas_lote from anon;
revoke insert, update, delete on public.cargas_lote from authenticated;

-- Peso nominal de cada presentación (kg por unidad); granel no tiene.
create or replace function public.kg_por_unidad(p_presentacion text)
returns numeric language sql immutable as $$
  select case p_presentacion when 'saco_50' then 50 when 'saco_40' then 40 when 'big_bag_1200' then 1200 end::numeric
$$;

-- Mantiene asignaciones.kg_lotes.
create or replace function public.trg_kg_lotes()
returns trigger language plpgsql security definer
set search_path = public as $$
declare v_asig uuid := coalesce(new.asignacion_id, old.asignacion_id);
begin
  update public.asignaciones
     set kg_lotes = (select sum(kg) from public.cargas_lote where asignacion_id = v_asig)
   where id = v_asig;
  if tg_op = 'UPDATE' and new.asignacion_id is distinct from old.asignacion_id then
    update public.asignaciones
       set kg_lotes = (select sum(kg) from public.cargas_lote where asignacion_id = old.asignacion_id)
     where id = old.asignacion_id;
  end if;
  return null;
end $$;
create trigger cargas_lote_suma after insert or update or delete on public.cargas_lote
  for each row execute function public.trg_kg_lotes();

-- ---------------------------------------------------------------------------
-- Guardar un lote (nuevo, o corregir uno existente con p_lote_id)
-- p_datos: {producto_id, lote, fecha_produccion?, presentacion, unidades?, kg?}
-- ---------------------------------------------------------------------------
create or replace function public.guardar_lote(p_asignacion uuid, p_lote_id uuid, p_datos jsonb)
returns uuid language plpgsql security definer
set search_path = public as $$
declare
  a public.asignaciones;
  v_id uuid := p_lote_id;
  v_producto uuid := nullif(p_datos ->> 'producto_id', '')::uuid;
  v_lote text := upper(regexp_replace(btrim(coalesce(p_datos ->> 'lote', '')), '\s+', '', 'g'));
  v_pres text := coalesce(p_datos ->> 'presentacion', '');
  v_fecha date := nullif(p_datos ->> 'fecha_produccion', '')::date;
  v_unid integer := nullif(p_datos ->> 'unidades', '')::numeric::integer;
  v_kg numeric := nullif(p_datos ->> 'kg', '')::numeric;
begin
  if not public.puede_editar() then
    raise exception 'Solo el administrador o logística registran los lotes.' using errcode = '42501';
  end if;
  select * into a from public.asignaciones where id = p_asignacion;
  if a.id is null then raise exception 'No existe ese camión.'; end if;
  if coalesce(a.tramo, 1) <> 1 then
    raise exception 'Los lotes se registran en el camión que sale de fábrica (tramo 1).';
  end if;
  if a.etapa = 'cancelado' then raise exception 'El camión está cancelado.'; end if;
  if v_producto is null or not exists (select 1 from public.productos where id = v_producto) then
    raise exception 'Elija el producto del lote.';
  end if;
  if v_lote = '' then raise exception 'Escriba el número de lote.'; end if;
  if v_lote !~ '^[A-Z0-9][A-Z0-9./-]{0,39}$' then
    raise exception 'El número de lote solo admite letras, números, punto, guion y barra (hasta 40).';
  end if;
  if v_pres not in ('saco_50', 'saco_40', 'big_bag_1200', 'granel') then
    raise exception 'Elija la presentación.';
  end if;
  if v_fecha is not null and v_fecha > (now() at time zone 'America/La_Paz')::date then
    raise exception 'La fecha de producción no puede ser futura.';
  end if;
  if v_pres = 'granel' then
    if v_kg is null or v_kg <= 0 then raise exception 'En granel escriba el peso del lote en kg.'; end if;
    v_unid := null;
  else
    if v_unid is null or v_unid <= 0 then raise exception 'Escriba cuántos sacos o big bags del lote van en el camión.'; end if;
    v_kg := v_unid * public.kg_por_unidad(v_pres);
  end if;

  if v_id is null then
    insert into public.cargas_lote (asignacion_id, producto_id, lote, fecha_produccion, presentacion, unidades, kg)
    values (p_asignacion, v_producto, v_lote, v_fecha, v_pres, v_unid, v_kg)
    returning id into v_id;
  else
    update public.cargas_lote
       set producto_id = v_producto, lote = v_lote, fecha_produccion = v_fecha,
           presentacion = v_pres, unidades = v_unid, kg = v_kg
     where id = v_id and asignacion_id = p_asignacion;
    if not found then raise exception 'No existe ese lote en este camión.'; end if;
  end if;

  insert into public.eventos (asignacion_id, tipo, origen, detalle, registrado_por)
  values (p_asignacion, 'nota', 'despacho',
          jsonb_build_object('accion', case when p_lote_id is null then 'lote_agregado' else 'lote_corregido' end,
                             'lote', v_lote, 'presentacion', v_pres, 'unidades', v_unid, 'kg', v_kg),
          auth.uid());
  return v_id;
exception when unique_violation then
  raise exception 'Ese lote ya está registrado en este camión con la misma presentación: corrija sus unidades.';
end $$;

-- Quitar un lote cargado por error (queda en el historial del camión).
create or replace function public.quitar_lote(p_lote_id uuid)
returns void language plpgsql security definer
set search_path = public as $$
declare l public.cargas_lote;
begin
  if not public.puede_editar() then
    raise exception 'Solo el administrador o logística corrigen los lotes.' using errcode = '42501';
  end if;
  delete from public.cargas_lote where id = p_lote_id returning * into l;
  if l.id is null then raise exception 'No existe ese lote.'; end if;
  insert into public.eventos (asignacion_id, tipo, origen, detalle, registrado_por)
  values (l.asignacion_id, 'nota', 'despacho',
          jsonb_build_object('accion', 'lote_quitado', 'lote', l.lote, 'presentacion', l.presentacion,
                             'unidades', l.unidades, 'kg', l.kg),
          auth.uid());
end $$;

-- ---------------------------------------------------------------------------
-- Registrar el ticket de balanza: con bruto y tara (kg), o solo el neto (t).
-- ---------------------------------------------------------------------------
create or replace function public.registrar_balanza(
  p_asignacion uuid, p_ticket text, p_bruto_kg numeric, p_tara_kg numeric, p_neto_t numeric
) returns numeric language plpgsql security definer
set search_path = public as $$
declare a public.asignaciones; v_neto numeric;
begin
  if not public.puede_editar() then
    raise exception 'Solo el administrador o logística registran el peso.' using errcode = '42501';
  end if;
  select * into a from public.asignaciones where id = p_asignacion;
  if a.id is null then raise exception 'No existe ese camión.'; end if;
  if coalesce(a.tramo, 1) <> 1 then raise exception 'El peso de balanza es del camión que sale de fábrica (tramo 1).'; end if;
  if (p_bruto_kg is null) <> (p_tara_kg is null) then
    raise exception 'Escriba el peso bruto y la tara, o solo el neto.';
  end if;
  if p_bruto_kg is not null then
    if p_bruto_kg <= p_tara_kg then raise exception 'El peso bruto debe ser mayor que la tara.'; end if;
    v_neto := round((p_bruto_kg - p_tara_kg) / 1000.0, 2);
  else
    v_neto := p_neto_t;
  end if;
  if v_neto is null or v_neto <= 0 or v_neto > 60 then
    raise exception 'El neto debe estar entre 0 y 60 toneladas.';
  end if;
  update public.asignaciones
     set ticket_balanza = nullif(btrim(coalesce(p_ticket, '')), ''),
         peso_bruto_kg = p_bruto_kg, tara_kg = p_tara_kg, toneladas_cargadas = v_neto
   where id = p_asignacion;
  return v_neto;
end $$;

-- ---------------------------------------------------------------------------
-- Buscar un lote: dónde fue (prefijo, sin importar mayúsculas). Solo lectura.
-- ---------------------------------------------------------------------------
create or replace function public.buscar_lote(p_texto text)
returns jsonb language plpgsql stable security definer
set search_path = public as $$
declare v_texto text := regexp_replace(upper(coalesce(p_texto, '')), '[^A-Z0-9./-]', '', 'g');
begin
  if not public.es_personal() then raise exception 'Sin permiso.' using errcode = '42501'; end if;
  if length(v_texto) < 2 then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(fila order by fila ->> 'salida' desc nulls first, fila ->> 'lote')
      from (
        select jsonb_build_object(
          'lote', l.lote, 'producto', pr.nombre, 'presentacion', l.presentacion, 'unidades', l.unidades,
          'kg', l.kg, 'fecha_produccion', l.fecha_produccion,
          'asignacion_id', a.id, 'placa', v.placa, 'transportista', t.razon_social, 'etapa', a.etapa,
          'mision_id', m.id, 'mision', m.codigo, 'cliente', c.razon_social, 'pais_cliente', c.pais,
          'destino', u.nombre, 'pedido', pe.codigo, 'pedido_id', pe.id, 'factura', m.factura,
          'salida', (select min(e.ocurrido_en) from public.eventos e
                      where e.asignacion_id = a.id and e.tipo = 'cambio_etapa'
                        and e.etapa_nueva in ('en_ruta', 'en_frontera', 'cruzo_frontera', 'entregado')),
          'entrega', case when m.etapa = 'entregado' then
                       (select max(e.ocurrido_en) from public.eventos e join public.asignaciones a2 on a2.id = e.asignacion_id
                         where a2.mision_id = m.id and e.tipo = 'cambio_etapa' and e.etapa_nueva = 'entregado') end
        ) as fila
          from public.cargas_lote l
          join public.asignaciones a on a.id = l.asignacion_id
          join public.misiones m on m.id = a.mision_id
          join public.clientes c on c.id = m.cliente_id
          join public.ubicaciones u on u.id = m.destino_id
          join public.productos pr on pr.id = l.producto_id
          left join public.vehiculos v on v.id = a.vehiculo_id
          left join public.transportistas t on t.id = a.transportista_id
          left join public.programa_envios pe_env on pe_env.id = m.envio_id
          left join public.pedidos pe on pe.id = pe_env.pedido_id
         where l.lote like v_texto || '%'
         limit 500
      ) s
  ), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- Permisos de ejecución
-- ---------------------------------------------------------------------------
revoke execute on function public.trg_neto_balanza(), public.trg_kg_lotes() from public, anon, authenticated;
revoke execute on function public.guardar_lote(uuid, uuid, jsonb), public.quitar_lote(uuid),
  public.registrar_balanza(uuid, text, numeric, numeric, numeric), public.buscar_lote(text) from public, anon;
grant execute on function public.guardar_lote(uuid, uuid, jsonb), public.quitar_lote(uuid),
  public.registrar_balanza(uuid, text, numeric, numeric, numeric), public.buscar_lote(text),
  public.kg_por_unidad(text) to authenticated;
