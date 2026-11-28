-- =============================================================================
-- Reversión de 20261211000100_pedido_programa.sql
-- Vuelve al diseño anterior (el total del pedido = suma de sus envíos).
--  * Los envíos «planificado» pasan a «pendiente» (en pedidos confirmados, su
--    fecha queda como comprometida, como hacía antes la confirmación).
--  * Un pedido sin envíos recibe uno con sus toneladas y su fecha límite.
--  * Se pierden las columnas toneladas, entrega_desde y entrega_hasta del pedido.
--  * Se vuelven a crear las funciones de 20261210000100_pedidos.sql.
-- =============================================================================
begin;
set search_path = public, extensions;
drop function if exists public.crear_pedido_con_programa(jsonb, jsonb);
drop function if exists public.confirmar_programa(uuid);
drop function if exists public.guardar_programa(uuid, jsonb);
drop function if exists public.guardar_pedido(uuid, jsonb);

update public.programa_envios e
   set estado = 'pendiente',
       entrega_comprometida = case when p.estado in ('confirmado', 'en_ejecucion') then e.entrega_vigente end
  from public.pedidos p
 where p.id = e.pedido_id and e.estado = 'planificado';
alter table public.programa_envios drop constraint programa_envios_estado_check;
alter table public.programa_envios add constraint programa_envios_estado_check
  check (estado in ('pendiente', 'en_curso', 'cumplido', 'cancelado'));
alter table public.programa_envios alter column estado set default 'pendiente';

-- El diseño anterior exige al menos un envío: un pedido sin programa recibe uno con
-- sus toneladas y su fecha límite, para no perder esos datos.
insert into public.programa_envios (pedido_id, numero, toneladas, entrega_vigente, entrega_comprometida, estado)
select p.id, 1, p.toneladas, p.entrega_hasta,
       case when p.estado in ('confirmado', 'en_ejecucion') then p.entrega_hasta end,
       case when p.estado = 'cancelado' then 'cancelado' else 'pendiente' end
  from public.pedidos p
 where not exists (select 1 from public.programa_envios e where e.pedido_id = p.id);

alter table public.pedidos
  drop constraint if exists pedidos_toneladas_check,
  drop constraint if exists pedidos_plazo_check,
  drop column toneladas,
  drop column entrega_desde,
  drop column entrega_hasta;

-- Funciones tal como estaban en 20261210000100_pedidos.sql
-- ---------------------------------------------------------------------------
-- Crear o editar un pedido en borrador (con su programa de envíos completo)
-- p_datos: {cliente_id, orden_compra, producto, destino_id, incoterm, hito?, notas?, origen?}
-- p_envios: [{toneladas, entrega, carga?}, …] en orden.
-- ---------------------------------------------------------------------------
create or replace function public.guardar_pedido(p_pedido uuid, p_datos jsonb, p_envios jsonb)
returns uuid language plpgsql security definer
set search_path = public as $$
declare
  v_id uuid := p_pedido;
  v_cliente uuid := nullif(p_datos ->> 'cliente_id', '')::uuid;
  v_incoterm text := upper(trim(coalesce(p_datos ->> 'incoterm', '')));
  v_actual public.pedidos;
  e jsonb;
  n int := 0;
begin
  if v_cliente is null or not exists (select 1 from public.clientes where id = v_cliente) then
    raise exception 'Elija el cliente.';
  end if;
  if not public.puede_editar_pedidos(v_cliente) then
    raise exception 'Solo el administrador o el comercial de este cliente pueden cargar sus pedidos.' using errcode = '42501';
  end if;
  if coalesce(trim(p_datos ->> 'producto'), '') = '' then
    raise exception 'Escriba el producto.';
  end if;
  if not exists (select 1 from public.ubicaciones where id = nullif(p_datos ->> 'destino_id', '')::uuid) then
    raise exception 'Elija el destino.';
  end if;
  if jsonb_typeof(p_envios) <> 'array' or jsonb_array_length(p_envios) = 0 then
    raise exception 'Agregue al menos un envío con toneladas y fecha de entrega.';
  end if;
  if jsonb_array_length(p_envios) > 99 then
    raise exception 'Un pedido puede tener hasta 99 envíos.';
  end if;

  if v_id is not null then
    select * into v_actual from public.pedidos where id = v_id for update;
    if v_actual.id is null then raise exception 'No existe ese pedido.'; end if;
    if v_actual.estado <> 'borrador' then
      raise exception 'El pedido ya está confirmado: use «Reprogramar» en cada envío para que quede el historial.';
    end if;
    if not public.puede_editar_pedidos(v_actual.cliente_id) then
      raise exception 'Solo el administrador o el comercial de este cliente pueden cambiar sus pedidos.' using errcode = '42501';
    end if;
    update public.pedidos set
      cliente_id = v_cliente,
      orden_compra = nullif(trim(p_datos ->> 'orden_compra'), ''),
      producto = trim(p_datos ->> 'producto'),
      destino_id = (p_datos ->> 'destino_id')::uuid,
      incoterm = v_incoterm,
      hito = coalesce(nullif(p_datos ->> 'hito', ''), case when v_incoterm = 'EXW' then 'carga' else 'entrega' end),
      notas = nullif(trim(coalesce(p_datos ->> 'notas', '')), ''),
      comercial_id = coalesce((select comercial_id from public.clientes where id = v_cliente), comercial_id),
      actualizado_en = now()
     where id = v_id;
    delete from public.programa_envios where pedido_id = v_id;
  else
    insert into public.pedidos (cliente_id, comercial_id, orden_compra, producto, destino_id, incoterm, hito, notas, origen)
    values (v_cliente,
            coalesce((select comercial_id from public.clientes where id = v_cliente),
                     case when public.es_comercial() then auth.uid() end),
            nullif(trim(p_datos ->> 'orden_compra'), ''), trim(p_datos ->> 'producto'),
            (p_datos ->> 'destino_id')::uuid, v_incoterm,
            coalesce(nullif(p_datos ->> 'hito', ''), case when v_incoterm = 'EXW' then 'carga' else 'entrega' end),
            nullif(trim(coalesce(p_datos ->> 'notas', '')), ''),
            coalesce(nullif(p_datos ->> 'origen', ''), 'manual'))
    returning id into v_id;
  end if;

  for e in select * from jsonb_array_elements(p_envios) loop
    n := n + 1;
    if coalesce((e ->> 'toneladas')::numeric, 0) <= 0 then
      raise exception 'Envío %: escriba las toneladas (mayor que 0).', n;
    end if;
    if nullif(e ->> 'entrega', '') is null then
      raise exception 'Envío %: elija la fecha de entrega.', n;
    end if;
    if nullif(e ->> 'carga', '') is not null and (e ->> 'carga')::date > (e ->> 'entrega')::date then
      raise exception 'Envío %: la fecha de carga no puede ser posterior a la de entrega.', n;
    end if;
    insert into public.programa_envios (pedido_id, numero, toneladas, entrega_vigente, fecha_carga_planificada)
    values (v_id, n, (e ->> 'toneladas')::numeric, (e ->> 'entrega')::date, nullif(e ->> 'carga', '')::date);
  end loop;
  return v_id;
exception
  when unique_violation then
    raise exception 'Ese cliente ya tiene un pedido con la orden de compra «%». Revise si es el mismo.', p_datos ->> 'orden_compra';
  when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
    raise exception 'Revise los datos: hay una fecha o un número con formato incorrecto.';
end $$;

-- Confirma el pedido: la fecha de entrega de cada envío pasa a ser el compromiso.
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
  if not exists (select 1 from public.programa_envios where pedido_id = p_pedido) then
    raise exception 'Agregue al menos un envío antes de confirmar.';
  end if;
  update public.programa_envios set entrega_comprometida = entrega_vigente where pedido_id = p_pedido;
  update public.pedidos set estado = 'confirmado', confirmado_en = now(), confirmado_por = auth.uid(), actualizado_en = now()
   where id = p_pedido;
end $$;

-- Cambia la fecha (y opcionalmente las toneladas) de un envío confirmado, con causa.
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
  select * into p from public.pedidos where id = e.pedido_id;
  if not public.puede_editar_pedidos(p.cliente_id) then
    raise exception 'Solo el administrador o el comercial de este cliente pueden reprogramar.' using errcode = '42501';
  end if;
  if p.estado not in ('confirmado', 'en_ejecucion') or e.estado not in ('pendiente', 'en_curso') then
    raise exception 'Solo se reprograman envíos pendientes de un pedido confirmado.';
  end if;
  if p_causa not in ('cliente', 'produccion', 'transporte', 'aduana', 'clima_via', 'otra') then
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

-- Cancela un envío pendiente (queda en el historial con su causa).
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
  if not public.puede_editar_pedidos(p.cliente_id) then
    raise exception 'Solo el administrador o el comercial de este cliente pueden cancelar envíos.' using errcode = '42501';
  end if;
  if p.estado not in ('confirmado', 'en_ejecucion') or e.estado <> 'pendiente' then
    raise exception 'Solo se cancelan envíos pendientes de un pedido confirmado.';
  end if;
  if p_causa not in ('cliente', 'produccion', 'transporte', 'aduana', 'clima_via', 'otra') then
    raise exception 'Elija la causa.';
  end if;
  insert into public.cambios_compromiso (envio_id, tipo, fecha_anterior, toneladas_anterior, causa, nota, mueve_compromiso)
  values (p_envio, 'cancelado', e.entrega_vigente, e.toneladas, p_causa, nullif(trim(coalesce(p_nota, '')), ''), p_causa = 'cliente');
  update public.programa_envios set estado = 'cancelado' where id = p_envio;
  -- Si ya no queda ningún envío vivo, el pedido queda cancelado.
  if not exists (select 1 from public.programa_envios where pedido_id = p.id and estado <> 'cancelado') then
    update public.pedidos set estado = 'cancelado', motivo_cancelacion = 'Todos sus envíos fueron cancelados.', actualizado_en = now()
     where id = p.id;
  else
    update public.pedidos set actualizado_en = now() where id = p.id;
  end if;
end $$;

-- Cancela un pedido completo (borrador o confirmado sin envíos en curso).
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
  if p.estado <> 'borrador' then
    insert into public.cambios_compromiso (envio_id, tipo, fecha_anterior, toneladas_anterior, causa, nota, mueve_compromiso)
    select id, 'cancelado', entrega_vigente, toneladas, 'otra', 'Pedido cancelado: ' || trim(p_motivo), false
      from public.programa_envios where pedido_id = p_pedido and estado = 'pendiente';
  end if;
  update public.programa_envios set estado = 'cancelado' where pedido_id = p_pedido and estado = 'pendiente';
  update public.pedidos set estado = 'cancelado', motivo_cancelacion = trim(p_motivo), actualizado_en = now() where id = p_pedido;
end $$;

revoke execute on function public.puede_editar_pedidos(uuid), public.guardar_pedido(uuid, jsonb, jsonb),
  public.confirmar_pedido(uuid), public.reprogramar_envio(uuid, date, numeric, text, text),
  public.cancelar_envio(uuid, text, text), public.cancelar_pedido(uuid, text)
  from public, anon;
grant execute on function public.puede_editar_pedidos(uuid), public.guardar_pedido(uuid, jsonb, jsonb),
  public.confirmar_pedido(uuid), public.reprogramar_envio(uuid, date, numeric, text, text),
  public.cancelar_envio(uuid, text, text), public.cancelar_pedido(uuid, text)
  to authenticated;

drop function if exists public.toneladas_programadas(uuid, uuid);
drop function if exists public.puede_programar(uuid);
commit;
