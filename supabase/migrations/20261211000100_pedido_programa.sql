-- =============================================================================
-- Fase C2b: el pedido y el programa de envíos son cosas distintas
--
--  * El PEDIDO es lo que el cliente compra: orden de compra, producto, toneladas
--    pedidas, destino, Incoterm y plazo (entrega_desde / entrega_hasta). Lo registra
--    el comercial y al confirmarlo se acepta la orden, sin fechas de camiones.
--  * El PROGRAMA DE ENVÍOS es cómo se entrega: un envío por camión con su fecha.
--    Los envíos nacen «planificados» (se cambian libremente) y al confirmar el
--    programa pasan a «pendiente»: su fecha de entrega queda como compromiso y
--    desde ahí solo se mueve con «Reprogramar» y causa.
--  * Lo programado no puede superar lo pedido + 3 % (peso real de cada camión).
--  * Arman el programa: el administrador, el comercial del cliente y logística.
--
-- Datos existentes: cada pedido recibe como toneladas la suma de sus envíos y como
-- plazo sus fechas mínima y máxima; los envíos de pedidos en borrador (sin fecha
-- comprometida) pasan a «planificado». No se borra nada.
-- Reversión: supabase/revertir/20261211000100_pedido_programa.sql
-- =============================================================================
set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Pedido: cantidad y plazo propios
-- ---------------------------------------------------------------------------
alter table public.pedidos
  add column toneladas numeric(10, 2),
  add column entrega_desde date,
  add column entrega_hasta date;

update public.pedidos p
   set toneladas = s.total, entrega_desde = s.desde, entrega_hasta = s.hasta
  from (select pedido_id,
               coalesce(sum(toneladas) filter (where estado <> 'cancelado'), sum(toneladas)) as total,
               min(entrega_vigente) as desde, max(entrega_vigente) as hasta
          from public.programa_envios group by pedido_id) s
 where s.pedido_id = p.id;

alter table public.pedidos
  alter column toneladas set not null,
  alter column entrega_hasta set not null,
  add constraint pedidos_toneladas_check check (toneladas > 0 and toneladas <= 100000),
  add constraint pedidos_plazo_check check (entrega_desde is null or entrega_desde <= entrega_hasta);
comment on column public.pedidos.toneladas is 'Toneladas que pidió el cliente (no la suma del programa).';
comment on column public.pedidos.entrega_hasta is 'Fecha límite de entrega que pide el cliente para todo el pedido.';

-- ---------------------------------------------------------------------------
-- Envíos: estado «planificado» antes de confirmar el programa
-- ---------------------------------------------------------------------------
alter table public.programa_envios drop constraint programa_envios_estado_check;
alter table public.programa_envios add constraint programa_envios_estado_check
  check (estado in ('planificado', 'pendiente', 'en_curso', 'cumplido', 'cancelado'));
alter table public.programa_envios alter column estado set default 'planificado';
update public.programa_envios set estado = 'planificado' where estado = 'pendiente' and entrega_comprometida is null;

-- ---------------------------------------------------------------------------
-- Permiso para armar y cambiar el programa
-- ---------------------------------------------------------------------------
create or replace function public.puede_programar(p_cliente uuid)
returns boolean language sql stable security definer
set search_path = public as $$
  select public.puede_editar() or public.puede_editar_pedidos(p_cliente)
$$;

-- Toneladas vivas del programa (sin cancelados), opcionalmente sin un envío.
create or replace function public.toneladas_programadas(p_pedido uuid, p_sin_envio uuid default null)
returns numeric language sql stable security definer
set search_path = public as $$
  select coalesce(sum(toneladas), 0) from public.programa_envios
   where pedido_id = p_pedido and estado <> 'cancelado' and id is distinct from p_sin_envio
$$;

-- ---------------------------------------------------------------------------
-- Pedido (sin envíos)
-- p_datos: {cliente_id, orden_compra, producto, toneladas, entrega_desde?, entrega_hasta,
--           destino_id, incoterm, hito?, notas?, origen?}
-- ---------------------------------------------------------------------------
drop function public.guardar_pedido(uuid, jsonb, jsonb);
create function public.guardar_pedido(p_pedido uuid, p_datos jsonb)
returns uuid language plpgsql security definer
set search_path = public as $$
declare
  v_id uuid := p_pedido;
  v_cliente uuid := nullif(p_datos ->> 'cliente_id', '')::uuid;
  v_incoterm text := upper(trim(coalesce(p_datos ->> 'incoterm', '')));
  v_ton numeric := nullif(p_datos ->> 'toneladas', '')::numeric;
  v_desde date := nullif(p_datos ->> 'entrega_desde', '')::date;
  v_hasta date := nullif(p_datos ->> 'entrega_hasta', '')::date;
  v_actual public.pedidos;
begin
  if v_cliente is null or not exists (select 1 from public.clientes where id = v_cliente) then
    raise exception 'Elija el cliente.';
  end if;
  if not public.puede_editar_pedidos(v_cliente) then
    raise exception 'Solo el administrador o el comercial de este cliente pueden cargar sus pedidos.' using errcode = '42501';
  end if;
  if coalesce(trim(p_datos ->> 'producto'), '') = '' then raise exception 'Escriba el producto.'; end if;
  if coalesce(v_ton, 0) <= 0 then raise exception 'Escriba las toneladas que pidió el cliente (mayor que 0).'; end if;
  if v_hasta is null then raise exception 'Elija la fecha límite de entrega que pide el cliente.'; end if;
  if v_desde is not null and v_desde > v_hasta then
    raise exception 'La fecha «desde» no puede ser posterior a la fecha límite.';
  end if;
  if not exists (select 1 from public.ubicaciones where id = nullif(p_datos ->> 'destino_id', '')::uuid) then
    raise exception 'Elija el destino.';
  end if;

  if v_id is not null then
    select * into v_actual from public.pedidos where id = v_id for update;
    if v_actual.id is null then raise exception 'No existe ese pedido.'; end if;
    if v_actual.estado <> 'borrador' then
      raise exception 'El pedido ya está confirmado: si el cliente cambió la orden, cancélelo y cárguelo de nuevo.';
    end if;
    if not public.puede_editar_pedidos(v_actual.cliente_id) then
      raise exception 'Solo el administrador o el comercial de este cliente pueden cambiar sus pedidos.' using errcode = '42501';
    end if;
    if public.toneladas_programadas(v_id) > v_ton * 1.03 then
      raise exception 'El programa ya tiene % t: quite envíos antes de bajar el pedido a % t.', public.toneladas_programadas(v_id), v_ton;
    end if;
    update public.pedidos set
      cliente_id = v_cliente,
      orden_compra = nullif(trim(p_datos ->> 'orden_compra'), ''),
      producto = trim(p_datos ->> 'producto'),
      toneladas = v_ton, entrega_desde = v_desde, entrega_hasta = v_hasta,
      destino_id = (p_datos ->> 'destino_id')::uuid,
      incoterm = v_incoterm,
      hito = coalesce(nullif(p_datos ->> 'hito', ''), case when v_incoterm = 'EXW' then 'carga' else 'entrega' end),
      notas = nullif(trim(coalesce(p_datos ->> 'notas', '')), ''),
      comercial_id = coalesce((select comercial_id from public.clientes where id = v_cliente), comercial_id),
      actualizado_en = now()
     where id = v_id;
  else
    insert into public.pedidos (cliente_id, comercial_id, orden_compra, producto, toneladas, entrega_desde, entrega_hasta,
                                destino_id, incoterm, hito, notas, origen)
    values (v_cliente,
            coalesce((select comercial_id from public.clientes where id = v_cliente),
                     case when public.es_comercial() then auth.uid() end),
            nullif(trim(p_datos ->> 'orden_compra'), ''), trim(p_datos ->> 'producto'), v_ton, v_desde, v_hasta,
            (p_datos ->> 'destino_id')::uuid, v_incoterm,
            coalesce(nullif(p_datos ->> 'hito', ''), case when v_incoterm = 'EXW' then 'carga' else 'entrega' end),
            nullif(trim(coalesce(p_datos ->> 'notas', '')), ''),
            coalesce(nullif(p_datos ->> 'origen', ''), 'manual'))
    returning id into v_id;
  end if;
  return v_id;
exception
  when unique_violation then
    raise exception 'Ese cliente ya tiene un pedido con la orden de compra «%». Revise si es el mismo.', p_datos ->> 'orden_compra';
  when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
    raise exception 'Revise los datos: hay una fecha o un número con formato incorrecto.';
end $$;

-- Confirma el pedido: se acepta la orden del cliente (cantidad y plazo). No hace falta programa.
create or replace function public.confirmar_pedido(p_pedido uuid)
returns void language plpgsql security definer
set search_path = public as $$
declare
  v public.pedidos;
begin
  select * into v from public.pedidos where id = p_pedido for update;
  if v.id is null then raise exception 'No existe ese pedido.'; end if;
  if not public.puede_editar_pedidos(v.cliente_id) then
    raise exception 'Solo el administrador o el comercial de este cliente pueden confirmar sus pedidos.' using errcode = '42501';
  end if;
  if v.estado <> 'borrador' then raise exception 'El pedido ya estaba confirmado o cancelado.'; end if;
  update public.pedidos set estado = 'confirmado', confirmado_en = now(), confirmado_por = auth.uid(), actualizado_en = now()
   where id = p_pedido;
end $$;

-- ---------------------------------------------------------------------------
-- Programa de envíos
-- ---------------------------------------------------------------------------
-- Reemplaza los envíos PLANIFICADOS del pedido (los confirmados no se tocan).
-- p_envios: [{toneladas, entrega, carga?}, …]; vacío = quitar los planificados.
create or replace function public.guardar_programa(p_pedido uuid, p_envios jsonb)
returns void language plpgsql security definer
set search_path = public as $$
declare
  p public.pedidos;
  e jsonb;
  n int;
  i int := 0;
  v_total numeric;
begin
  select * into p from public.pedidos where id = p_pedido for update;
  if p.id is null then raise exception 'No existe ese pedido.'; end if;
  if not public.puede_programar(p.cliente_id) then
    raise exception 'Solo el administrador, el comercial del cliente o logística arman el programa.' using errcode = '42501';
  end if;
  if p.estado not in ('borrador', 'confirmado', 'en_ejecucion') then
    raise exception 'El pedido está cerrado: ya no se programan envíos.';
  end if;
  if jsonb_typeof(p_envios) <> 'array' then raise exception 'El programa debe ser una lista de envíos.'; end if;

  delete from public.programa_envios where pedido_id = p_pedido and estado = 'planificado';
  select coalesce(max(numero), 0) into n from public.programa_envios where pedido_id = p_pedido;
  if n + jsonb_array_length(p_envios) > 99 then raise exception 'Un pedido puede tener hasta 99 envíos.'; end if;

  for e in select * from jsonb_array_elements(p_envios) loop
    i := i + 1;
    if coalesce(nullif(e ->> 'toneladas', '')::numeric, 0) <= 0 then
      raise exception 'Envío %: escriba las toneladas (mayor que 0).', n + i;
    end if;
    if nullif(e ->> 'entrega', '') is null then
      raise exception 'Envío %: elija la fecha de entrega.', n + i;
    end if;
    if nullif(e ->> 'carga', '') is not null and (e ->> 'carga')::date > (e ->> 'entrega')::date then
      raise exception 'Envío %: la fecha de carga no puede ser posterior a la de entrega.', n + i;
    end if;
    insert into public.programa_envios (pedido_id, numero, toneladas, entrega_vigente, fecha_carga_planificada, estado)
    values (p_pedido, n + i, (e ->> 'toneladas')::numeric, (e ->> 'entrega')::date, nullif(e ->> 'carga', '')::date, 'planificado');
  end loop;

  v_total := public.toneladas_programadas(p_pedido);
  if v_total > p.toneladas * 1.03 then
    raise exception 'El programa suma % t y el pedido es de % t (se acepta hasta 3 %% más por el peso real de cada camión).',
      v_total, p.toneladas;
  end if;
  update public.pedidos set actualizado_en = now() where id = p_pedido;
exception
  when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
    raise exception 'Revise el programa: hay una fecha o un número con formato incorrecto.';
end $$;

-- Confirma los envíos planificados: su fecha de entrega pasa a ser el compromiso con el cliente.
create or replace function public.confirmar_programa(p_pedido uuid)
returns integer language plpgsql security definer
set search_path = public as $$
declare
  p public.pedidos;
  n int;
begin
  select * into p from public.pedidos where id = p_pedido for update;
  if p.id is null then raise exception 'No existe ese pedido.'; end if;
  if not public.puede_programar(p.cliente_id) then
    raise exception 'Solo el administrador, el comercial del cliente o logística confirman el programa.' using errcode = '42501';
  end if;
  if p.estado not in ('confirmado', 'en_ejecucion') then
    raise exception 'Primero confirme el pedido; después, su programa de envíos.';
  end if;
  update public.programa_envios set estado = 'pendiente', entrega_comprometida = entrega_vigente
   where pedido_id = p_pedido and estado = 'planificado';
  get diagnostics n = row_count;
  if n = 0 then raise exception 'No hay envíos planificados por confirmar.'; end if;
  update public.pedidos set actualizado_en = now() where id = p_pedido;
  return n;
end $$;

-- Cambia la fecha (y si hace falta las toneladas) de un envío confirmado, con causa.
-- Si la causa es «cliente», la fecha comprometida también cambia (no es incumplimiento).
create or replace function public.reprogramar_envio(
  p_envio uuid, p_fecha date, p_toneladas numeric, p_causa text, p_nota text default null
) returns void language plpgsql security definer
set search_path = public as $$
declare
  e public.programa_envios;
  p public.pedidos;
  v_ton numeric := coalesce(p_toneladas, 0);
begin
  select * into e from public.programa_envios where id = p_envio for update;
  if e.id is null then raise exception 'No existe ese envío.'; end if;
  select * into p from public.pedidos where id = e.pedido_id for update;
  if not public.puede_programar(p.cliente_id) then
    raise exception 'Solo el administrador, el comercial del cliente o logística reprograman envíos.' using errcode = '42501';
  end if;
  if p.estado not in ('confirmado', 'en_ejecucion') or e.estado not in ('pendiente', 'en_curso') then
    raise exception 'Solo se reprograman envíos confirmados y pendientes. Un envío planificado se cambia en el programa.';
  end if;
  if p_causa is null or p_causa not in ('cliente', 'produccion', 'transporte', 'aduana', 'clima_via', 'otra') then
    raise exception 'Elija la causa del cambio.';
  end if;
  if p_causa = 'otra' and coalesce(trim(p_nota), '') = '' then
    raise exception 'Con la causa «Otra», escriba una nota que explique el cambio.';
  end if;
  if p_fecha is null then raise exception 'Elija la nueva fecha de entrega.'; end if;
  if v_ton <= 0 then v_ton := e.toneladas; end if;
  if p_fecha = e.entrega_vigente and v_ton = e.toneladas then
    raise exception 'No hay cambios: la fecha y las toneladas son las mismas.';
  end if;
  if public.toneladas_programadas(p.id, e.id) + v_ton > p.toneladas * 1.03 then
    raise exception 'Con % t el programa superaría las % t del pedido.', v_ton, p.toneladas;
  end if;
  insert into public.cambios_compromiso (envio_id, tipo, fecha_anterior, fecha_nueva, toneladas_anterior, toneladas_nueva,
                                         causa, nota, mueve_compromiso)
  values (p_envio, 'reprogramado', e.entrega_vigente, p_fecha, e.toneladas, v_ton, p_causa,
          nullif(trim(coalesce(p_nota, '')), ''), p_causa = 'cliente');
  update public.programa_envios
     set entrega_vigente = p_fecha,
         toneladas = v_ton,
         entrega_comprometida = case when p_causa = 'cliente' then p_fecha else entrega_comprometida end
   where id = p_envio;
  update public.pedidos set actualizado_en = now() where id = p.id;
end $$;

-- Cancela un envío confirmado y pendiente (queda en el historial con su causa).
-- El pedido sigue vivo: lo que falta se puede volver a programar.
create or replace function public.cancelar_envio(p_envio uuid, p_causa text, p_nota text default null)
returns void language plpgsql security definer
set search_path = public as $$
declare
  e public.programa_envios;
  p public.pedidos;
begin
  select * into e from public.programa_envios where id = p_envio for update;
  if e.id is null then raise exception 'No existe ese envío.'; end if;
  select * into p from public.pedidos where id = e.pedido_id for update;
  if not public.puede_programar(p.cliente_id) then
    raise exception 'Solo el administrador, el comercial del cliente o logística cancelan envíos.' using errcode = '42501';
  end if;
  if p.estado not in ('confirmado', 'en_ejecucion') or e.estado <> 'pendiente' then
    raise exception 'Solo se cancelan envíos confirmados y pendientes. Un envío planificado se quita en el programa.';
  end if;
  if p_causa is null or p_causa not in ('cliente', 'produccion', 'transporte', 'aduana', 'clima_via', 'otra') then
    raise exception 'Elija la causa.';
  end if;
  if p_causa = 'otra' and coalesce(trim(p_nota), '') = '' then
    raise exception 'Con la causa «Otra», escriba una nota que explique la cancelación.';
  end if;
  insert into public.cambios_compromiso (envio_id, tipo, fecha_anterior, toneladas_anterior, causa, nota, mueve_compromiso)
  values (p_envio, 'cancelado', e.entrega_vigente, e.toneladas, p_causa, nullif(trim(coalesce(p_nota, '')), ''), p_causa = 'cliente');
  update public.programa_envios set estado = 'cancelado' where id = p_envio;
  update public.pedidos set actualizado_en = now() where id = p.id;
end $$;

-- Cancela un pedido completo (sin envíos en curso ni entregados).
create or replace function public.cancelar_pedido(p_pedido uuid, p_motivo text)
returns void language plpgsql security definer
set search_path = public as $$
declare
  p public.pedidos;
begin
  select * into p from public.pedidos where id = p_pedido for update;
  if p.id is null then raise exception 'No existe ese pedido.'; end if;
  if not public.puede_editar_pedidos(p.cliente_id) then
    raise exception 'Solo el administrador o el comercial de este cliente pueden cancelar sus pedidos.' using errcode = '42501';
  end if;
  if p.estado in ('cumplido', 'cancelado') then raise exception 'El pedido ya está cerrado.'; end if;
  if exists (select 1 from public.programa_envios where pedido_id = p_pedido and estado in ('en_curso', 'cumplido')) then
    raise exception 'El pedido tiene envíos en curso o entregados: cancele solo los envíos pendientes.';
  end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Escriba el motivo de la cancelación.'; end if;
  insert into public.cambios_compromiso (envio_id, tipo, fecha_anterior, toneladas_anterior, causa, nota, mueve_compromiso)
  select id, 'cancelado', entrega_vigente, toneladas, 'otra', 'Pedido cancelado: ' || trim(p_motivo), false
    from public.programa_envios where pedido_id = p_pedido and estado = 'pendiente';
  update public.programa_envios set estado = 'cancelado' where pedido_id = p_pedido and estado in ('pendiente', 'planificado');
  update public.pedidos set estado = 'cancelado', motivo_cancelacion = trim(p_motivo), actualizado_en = now() where id = p_pedido;
end $$;

-- Importación desde Excel: pedido y programa planificado en una sola operación.
create or replace function public.crear_pedido_con_programa(p_datos jsonb, p_envios jsonb)
returns uuid language plpgsql security definer
set search_path = public as $$
declare
  v_id uuid;
begin
  v_id := public.guardar_pedido(null, p_datos);
  if jsonb_typeof(p_envios) = 'array' and jsonb_array_length(p_envios) > 0 then
    perform public.guardar_programa(v_id, p_envios);
  end if;
  return v_id;
end $$;

revoke execute on function public.puede_programar(uuid), public.toneladas_programadas(uuid, uuid),
  public.guardar_pedido(uuid, jsonb), public.guardar_programa(uuid, jsonb), public.confirmar_programa(uuid),
  public.crear_pedido_con_programa(jsonb, jsonb)
  from public, anon;
grant execute on function public.puede_programar(uuid), public.toneladas_programadas(uuid, uuid),
  public.guardar_pedido(uuid, jsonb), public.guardar_programa(uuid, jsonb), public.confirmar_programa(uuid),
  public.crear_pedido_con_programa(jsonb, jsonb)
  to authenticated;
