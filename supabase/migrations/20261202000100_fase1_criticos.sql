-- =============================================================================
-- Fase 1 de la revisión externa (27/11/2026): errores críticos.
--   1.1 Teléfonos en formato internacional (E.164: +591 Bolivia, +51 Perú).
--   1.2 Orden de los eventos: hora del servidor y hora del dispositivo; ningún
--       cambio de etapa queda con hora anterior al cambio previo.
--   1.3 Camión detenido: desde cuándo no se mueve (más de 300 m) y minutos
--       configurables (30 por defecto). Salida de fábrica con 2 puntos seguidos y
--       alerta si el viaje empieza a más de 20 km del origen.
-- Reversible: supabase/revertir/20261202000100_fase1_criticos.sql
-- No borra datos: los teléfonos originales quedan en public.telefonos_respaldo.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1.1 Teléfonos
-- ---------------------------------------------------------------------------
-- Devuelve el número en formato E.164, o NULL si no se puede deducir con certeza.
--   67601782       -> +59167601782  (celular de Bolivia: 8 dígitos que empiezan con 6 o 7)
--   987654321      -> +51987654321  (celular de Perú: 9 dígitos que empiezan con 9)
--   59167601782    -> +59167601782,  0059167601782 -> +59167601782
--   +5491123456789 -> se acepta tal cual (otro país, ya con código)
create or replace function public.normalizar_telefono(p text)
returns text language plpgsql immutable
set search_path = public as $$
declare
  t text := regexp_replace(coalesce(p, ''), '[^0-9+]', '', 'g');
  d text;
begin
  if t = '' then
    return null;
  end if;
  if left(t, 2) = '00' then
    t := '+' || substr(t, 3);
  end if;
  d := replace(t, '+', '');
  if left(t, 1) = '+' then
    if left(d, 3) = '591' then
      return case when d ~ '^591[2-7][0-9]{7}$' then '+' || d end;
    end if;
    if left(d, 2) = '51' then
      return case when d ~ '^51[1-9][0-9]{7,8}$' then '+' || d end;
    end if;
    return case when d ~ '^[1-9][0-9]{7,14}$' then '+' || d end;
  end if;
  if d ~ '^[67][0-9]{7}$' then return '+591' || d; end if;
  if d ~ '^9[0-9]{8}$' then return '+51' || d; end if;
  if d ~ '^591[67][0-9]{7}$' then return '+' || d; end if;
  if d ~ '^519[0-9]{8}$' then return '+' || d; end if;
  return null;
end $$;

create or replace function public.es_telefono_e164(p text)
returns boolean language sql immutable
set search_path = public as $$
  select p ~ '^\+[1-9][0-9]{7,14}$'
$$;

-- Respaldo de los valores originales (para revisar o revertir).
create table if not exists public.telefonos_respaldo (
  tabla           text not null,
  fila_id         uuid not null,
  columna         text not null,
  valor_original  text,
  valor_nuevo     text,
  respaldado_en   timestamptz not null default now(),
  primary key (tabla, fila_id, columna)
);
alter table public.telefonos_respaldo enable row level security;
drop policy if exists telefonos_respaldo_leer on public.telefonos_respaldo;
create policy telefonos_respaldo_leer on public.telefonos_respaldo
  for select to authenticated using (public.puede_editar());

insert into public.telefonos_respaldo (tabla, fila_id, columna, valor_original, valor_nuevo)
select 'clientes', id, 'whatsapp', whatsapp, public.normalizar_telefono(whatsapp) from public.clientes where whatsapp is not null
union all
select 'conductores', id, 'telefono', telefono, public.normalizar_telefono(telefono) from public.conductores where telefono is not null
union all
select 'transportistas', id, 'telefono', telefono, public.normalizar_telefono(telefono) from public.transportistas where telefono is not null
union all
select 'misiones', id, 'telefono_coordinador', telefono_coordinador, public.normalizar_telefono(telefono_coordinador)
  from public.misiones where telefono_coordinador is not null
on conflict do nothing;

-- Al guardar, el número se lleva a E.164. Si se escribe un número nuevo que no se puede
-- llevar a E.164, se rechaza (los números antiguos que no cambian no bloquean otras ediciones).
create or replace function public.trg_normalizar_telefonos()
returns trigger language plpgsql
set search_path = public as $$
declare
  columna text := case tg_table_name when 'clientes' then 'whatsapp'
                                     when 'misiones' then 'telefono_coordinador'
                                     else 'telefono' end;
  nuevo text := nullif(trim(to_jsonb(new) ->> columna), '');
  anterior text := case when tg_op = 'UPDATE' then to_jsonb(old) ->> columna end;
  normal text := public.normalizar_telefono(nuevo);
begin
  if nuevo is not null and normal is null and nuevo is distinct from anterior then
    raise exception 'Teléfono no válido: «%». Escríbalo con código de país, por ejemplo +59171234567 (Bolivia) o +51987654321 (Perú).', nuevo
      using errcode = '23514', hint = columna;
  end if;
  new := jsonb_populate_record(new, jsonb_build_object(columna, coalesce(normal, nuevo)));
  return new;
end $$;

-- Corrige los existentes que se pueden deducir con certeza (los demás quedan igual y en la lista).
update public.clientes set whatsapp = public.normalizar_telefono(whatsapp)
 where public.normalizar_telefono(whatsapp) is not null and whatsapp is distinct from public.normalizar_telefono(whatsapp);
update public.conductores set telefono = public.normalizar_telefono(telefono)
 where public.normalizar_telefono(telefono) is not null and telefono is distinct from public.normalizar_telefono(telefono);
update public.transportistas set telefono = public.normalizar_telefono(telefono)
 where public.normalizar_telefono(telefono) is not null and telefono is distinct from public.normalizar_telefono(telefono);
update public.misiones set telefono_coordinador = public.normalizar_telefono(telefono_coordinador)
 where public.normalizar_telefono(telefono_coordinador) is not null
   and telefono_coordinador is distinct from public.normalizar_telefono(telefono_coordinador);

create trigger clientes_telefono before insert or update of whatsapp on public.clientes
  for each row execute function public.trg_normalizar_telefonos();
create trigger conductores_telefono before insert or update of telefono on public.conductores
  for each row execute function public.trg_normalizar_telefonos();
create trigger transportistas_telefono before insert or update of telefono on public.transportistas
  for each row execute function public.trg_normalizar_telefonos();
create trigger misiones_telefono before insert or update of telefono_coordinador on public.misiones
  for each row execute function public.trg_normalizar_telefonos();

-- Lista de números que hay que corregir a mano (la ve despacho en Catálogos).
create or replace function public.telefonos_por_corregir()
returns table (tabla text, fila_id uuid, nombre text, valor text)
language sql stable security invoker
set search_path = public as $$
  select 'clientes', id, razon_social, whatsapp from public.clientes
   where whatsapp is not null and not public.es_telefono_e164(whatsapp)
  union all
  select 'conductores', id, nombre, telefono from public.conductores
   where telefono is not null and not public.es_telefono_e164(telefono)
  union all
  select 'transportistas', id, razon_social, telefono from public.transportistas
   where telefono is not null and not public.es_telefono_e164(telefono)
  union all
  select 'misiones', id, codigo, telefono_coordinador from public.misiones
   where telefono_coordinador is not null and not public.es_telefono_e164(telefono_coordinador)
     and etapa not in ('entregado', 'cancelado')
$$;

-- ---------------------------------------------------------------------------
-- 1.2 Orden de los eventos
-- ---------------------------------------------------------------------------
-- creado_en ya es la hora del servidor; se agrega la hora que informó el teléfono.
alter table public.eventos add column if not exists hora_dispositivo timestamptz;
comment on column public.eventos.ocurrido_en is 'Hora del hecho usada para ordenar (nunca anterior al cambio de etapa previo).';
comment on column public.eventos.creado_en is 'Hora del servidor al registrar el evento.';
comment on column public.eventos.hora_dispositivo is 'Hora que informó el teléfono (GPS o reloj), tal como llegó.';

create or replace function public.aplicar_etapa(
  p_asignacion uuid,
  p_etapa public.etapa_envio,
  p_origen public.origen_evento,
  p_momento timestamptz default now(),
  p_detalle jsonb default '{}'::jsonb
) returns public.etapa_envio language plpgsql security definer
set search_path = public as $$
declare
  actual public.etapa_envio;
  previo timestamptz;
  momento timestamptz := least(coalesce(p_momento, now()), now());
  hora_disp timestamptz;
  detalle jsonb := coalesce(p_detalle, '{}'::jsonb);
begin
  select etapa into actual from public.asignaciones where id = p_asignacion for update;
  if actual is null then
    raise exception 'Asignación no encontrada' using errcode = 'P0002';
  end if;
  if actual = p_etapa then
    return actual;
  end if;
  -- Chofer y geocercas: nunca retroceder ni reabrir un viaje cerrado.
  if p_origen <> 'despacho' and (actual in ('entregado', 'cancelado') or p_etapa < actual) then
    return actual;
  end if;

  -- Hora del dispositivo: la del GPS (geocercas) o la que envía la app al pulsar un botón.
  if detalle ? 'hora_dispositivo' then
    begin
      hora_disp := (detalle ->> 'hora_dispositivo')::timestamptz;
    exception when others then
      hora_disp := null;
    end;
    detalle := detalle - 'hora_dispositivo';
  elsif p_origen = 'geocerca' then
    hora_disp := p_momento;
  end if;

  -- Una secuencia imposible no se registra: el cambio nunca queda antes del anterior.
  select max(ocurrido_en) into previo
    from public.eventos where asignacion_id = p_asignacion and tipo = 'cambio_etapa';
  if previo is not null and momento < previo then
    detalle := detalle || jsonb_build_object('hora_ajustada', true);
    momento := previo;
  end if;

  update public.asignaciones set etapa = p_etapa where id = p_asignacion;
  insert into public.eventos (asignacion_id, tipo, etapa_nueva, ocurrido_en, hora_dispositivo, origen, detalle, registrado_por)
  values (p_asignacion, 'cambio_etapa', p_etapa, momento, hora_disp, p_origen,
          detalle || jsonb_build_object('etapa_anterior', actual), auth.uid());

  -- Al entregar o cancelar, se cierra el acceso del chofer a esta misión.
  if p_etapa in ('entregado', 'cancelado') then
    update public.invitaciones_chofer set revocada = true
     where asignacion_id = p_asignacion and not revocada;
  end if;
  return p_etapa;
end $$;

-- Botones del chofer: ahora reciben también la hora del teléfono (opcional, app 0.1.6+).
drop function if exists public.marcar_etapa_chofer(uuid, public.etapa_envio);
create or replace function public.marcar_etapa_chofer(
  p_asignacion uuid,
  p_etapa public.etapa_envio,
  p_hora_dispositivo timestamptz default null
) returns jsonb language plpgsql security definer
set search_path = public as $$
declare
  inv public.invitaciones_chofer;
  actual public.etapa_envio;
begin
  inv := public.invitacion_de_sesion(p_asignacion);
  if inv.id is null then
    raise exception 'Sin acceso a este viaje' using errcode = '42501';
  end if;
  if not public.tiene_consentimiento(inv.conductor_id) then
    raise exception 'Debe aceptar la política de rastreo primero';
  end if;

  select etapa into actual from public.asignaciones where id = p_asignacion;

  if not (
       (p_etapa = 'cargado'     and actual = 'programado')
    or (p_etapa = 'en_frontera' and actual in ('cargado', 'en_ruta'))
    or (p_etapa = 'entregado'   and actual in ('cargado', 'en_ruta', 'en_frontera', 'cruzo_frontera'))
  ) then
    raise exception 'No se puede pasar de "%" a "%"', actual, p_etapa;
  end if;

  perform public.aplicar_etapa(p_asignacion, p_etapa, 'chofer', now(),
    case when p_hora_dispositivo is not null
         then jsonb_build_object('hora_dispositivo', p_hora_dispositivo) else '{}'::jsonb end);
  return jsonb_build_object('etapa', p_etapa);
end $$;

revoke execute on function public.marcar_etapa_chofer(uuid, public.etapa_envio, timestamptz) from public, anon;
grant execute on function public.marcar_etapa_chofer(uuid, public.etapa_envio, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 1.3 Camión detenido y salida de fábrica
-- ---------------------------------------------------------------------------
create table if not exists public.configuracion (
  clave           text primary key,
  valor           jsonb not null,
  actualizado_en  timestamptz not null default now()
);
alter table public.configuracion enable row level security;
drop policy if exists configuracion_leer on public.configuracion;
create policy configuracion_leer on public.configuracion
  for select to authenticated using (public.es_personal());
insert into public.configuracion (clave, valor) values ('detenido_minutos', '30')
on conflict (clave) do nothing;

create or replace function public.fijar_minutos_detenido(p_minutos integer)
returns void language plpgsql security definer
set search_path = public as $$
begin
  if not public.puede_editar() then
    raise exception 'No tiene permiso para cambiar la configuración' using errcode = '42501';
  end if;
  if p_minutos is null or p_minutos < 10 or p_minutos > 720 then
    raise exception 'Los minutos deben estar entre 10 y 720';
  end if;
  insert into public.configuracion (clave, valor, actualizado_en) values ('detenido_minutos', to_jsonb(p_minutos), now())
  on conflict (clave) do update set valor = excluded.valor, actualizado_en = now();
end $$;
revoke execute on function public.fijar_minutos_detenido(integer) from public, anon;
grant execute on function public.fijar_minutos_detenido(integer) to authenticated;

alter table public.asignaciones
  -- Punto donde quedó quieto y desde cuándo (se reinicia al moverse más de 300 m).
  add column if not exists detenido_desde        timestamptz,
  add column if not exists detenido_lat          double precision,
  add column if not exists detenido_lon          double precision,
  -- Primer punto fuera de la fábrica (la salida se confirma con el siguiente).
  add column if not exists salida_candidata_desde timestamptz;

create or replace function public.trg_detenido()
returns trigger language plpgsql
set search_path = public, extensions as $$
begin
  if new.ultima_lat is null or new.ultima_lon is null or new.ultima_senal is null then
    return new;
  end if;
  if new.detenido_lat is null
     or st_distance(st_setsrid(st_makepoint(new.ultima_lon, new.ultima_lat), 4326)::geography,
                    st_setsrid(st_makepoint(new.detenido_lon, new.detenido_lat), 4326)::geography) > 300 then
    new.detenido_lat := new.ultima_lat;
    new.detenido_lon := new.ultima_lon;
    new.detenido_desde := new.ultima_senal;
  end if;
  return new;
end $$;

create trigger asignaciones_detenido
  before update of ultima_lat, ultima_lon, ultima_senal on public.asignaciones
  for each row execute function public.trg_detenido();

-- Valor inicial para los camiones que ya están en viaje (desde su última señal).
update public.asignaciones
   set detenido_lat = ultima_lat, detenido_lon = ultima_lon, detenido_desde = ultima_senal
 where ultima_lat is not null and detenido_desde is null;

-- Geocercas: igual que antes, salvo la salida de fábrica (ver «cargado»).
create or replace function public.evaluar_geocercas(
  p_asignacion uuid,
  p_punto extensions.geography,
  p_momento timestamptz,
  p_precision_m integer default 0
) returns public.etapa_envio language plpgsql security definer
set search_path = public, extensions as $$
declare
  a record;
  origen record;
  destino record;
  frontera record;
  margen integer := greatest(coalesce(p_precision_m, 0), 0);
  cruzado boolean := false;
  espera interval;
  detalle jsonb;
begin
  select asg.id, asg.etapa, asg.frontera_actual_id, asg.cruce_candidato_desde, asg.salida_candidata_desde,
         m.origen_id, m.destino_id
    into a
    from public.asignaciones asg join public.misiones m on m.id = asg.mision_id
   where asg.id = p_asignacion;

  select punto, radio_m, pais into destino from public.ubicaciones where id = a.destino_id;

  if a.etapa = 'cargado' then
    select nombre, punto, radio_m into origen from public.ubicaciones where id = a.origen_id;
    -- Primer punto del viaje a más de 20 km del origen: algo no cuadra (teléfono en otro
    -- lugar, punto de origen mal ubicado). Se avisa a despacho y no se cambia la etapa todavía.
    if not exists (select 1 from public.posiciones po
                    where po.asignacion_id = p_asignacion and not po.simulada and po.capturado_en < p_momento)
       and st_distance(p_punto, origen.punto) > 20000 then
      if not exists (select 1 from public.eventos ev
                      where ev.asignacion_id = p_asignacion and ev.tipo = 'incidencia'
                        and ev.detalle ->> 'motivo' = 'inicio_lejos_de_origen') then
        insert into public.eventos (asignacion_id, tipo, origen, ocurrido_en, hora_dispositivo, detalle)
        values (p_asignacion, 'incidencia', 'sistema', least(p_momento, now()), p_momento,
                jsonb_build_object('motivo', 'inicio_lejos_de_origen', 'origen', origen.nombre,
                                   'km', round((st_distance(p_punto, origen.punto) / 1000)::numeric)));
      end if;
      return a.etapa;
    end if;

    -- Salida de fábrica: se confirma con 2 puntos seguidos fuera de la geocerca
    -- (un solo punto impreciso ya no marca «En ruta»).
    if st_dwithin(p_punto, origen.punto, origen.radio_m + margen) then
      if a.salida_candidata_desde is not null then
        update public.asignaciones set salida_candidata_desde = null where id = p_asignacion;
      end if;
      return a.etapa;
    end if;
    if a.salida_candidata_desde is null or p_momento <= a.salida_candidata_desde then
      update public.asignaciones set salida_candidata_desde = p_momento where id = p_asignacion;
      return a.etapa;
    end if;
    update public.asignaciones set salida_candidata_desde = null where id = p_asignacion;
    a.etapa := public.aplicar_etapa(p_asignacion, 'en_ruta', 'geocerca', a.salida_candidata_desde,
                                    jsonb_build_object('motivo', 'salio_de_origen'));
  end if;

  if a.etapa in ('cargado', 'en_ruta') then
    -- ¿Dentro de una frontera?
    select id, nombre into frontera
      from public.ubicaciones
     where tipo = 'frontera' and activo and st_dwithin(p_punto, punto, radio_m)
     order by st_distance(p_punto, punto)
     limit 1;
    if frontera.id is not null then
      update public.asignaciones
         set frontera_actual_id = frontera.id, cruce_candidato_desde = null
       where id = p_asignacion;
      return public.aplicar_etapa(p_asignacion, 'en_frontera', 'geocerca', p_momento,
                                  jsonb_build_object('frontera', frontera.nombre));
    end if;

    -- ¿Pasó la frontera sin detenerse (o sin señal) en un viaje a Perú?
    -- Frontera más cercana al punto, que esté "entre" el origen y el destino.
    if destino.pais = 'PE' and a.etapa = 'en_ruta' then
      select punto into origen from public.ubicaciones where id = a.origen_id;
      select f.id, f.nombre, f.punto, f.radio_m into frontera
        from public.ubicaciones f
       where f.tipo = 'frontera' and f.activo
         and st_distance(f.punto, destino.punto) < st_distance(origen.punto, destino.punto)
       order by st_distance(p_punto, f.punto)
       limit 1;
      if frontera.id is not null then
        cruzado := not st_dwithin(p_punto, frontera.punto, frontera.radio_m + margen)
                   and st_distance(p_punto, frontera.punto) < 150000      -- a menos de 150 km de esa frontera
                   and st_distance(p_punto, destino.punto) < st_distance(frontera.punto, destino.punto) - 5000;
        espera := interval '10 minutes';
        detalle := jsonb_build_object('frontera', frontera.nombre, 'motivo', 'cruce_sin_parada');
      end if;
    end if;
  elsif a.etapa = 'en_frontera' then
    if a.frontera_actual_id is null then
      select id into a.frontera_actual_id from public.ubicaciones
       where tipo = 'frontera' and activo order by st_distance(p_punto, punto) limit 1;
      if a.frontera_actual_id is null then
        return a.etapa;
      end if;
      update public.asignaciones set frontera_actual_id = a.frontera_actual_id where id = p_asignacion;
    end if;

    select id, nombre, punto, radio_m into frontera from public.ubicaciones where id = a.frontera_actual_id;
    cruzado := not st_dwithin(p_punto, frontera.punto, frontera.radio_m + margen)
               and st_distance(p_punto, destino.punto) < st_distance(frontera.punto, destino.punto);
    espera := interval '5 minutes';
    detalle := jsonb_build_object('frontera', frontera.nombre);
  else
    return a.etapa;
  end if;

  -- Histéresis: el cruce se confirma solo si los puntos lo siguen indicando durante "espera".
  if not cruzado then
    if a.cruce_candidato_desde is not null then
      update public.asignaciones set cruce_candidato_desde = null where id = p_asignacion;
    end if;
    return a.etapa;
  end if;

  if a.cruce_candidato_desde is null or p_momento < a.cruce_candidato_desde then
    update public.asignaciones set cruce_candidato_desde = p_momento where id = p_asignacion;
    return a.etapa;
  end if;

  if p_momento - a.cruce_candidato_desde >= espera then
    update public.asignaciones set cruce_candidato_desde = null where id = p_asignacion;
    a.etapa := public.aplicar_etapa(p_asignacion, 'cruzo_frontera', 'geocerca', a.cruce_candidato_desde, detalle);
  end if;
  return a.etapa;
end $$;

revoke execute on function public.evaluar_geocercas(uuid, extensions.geography, timestamptz, integer)
  from public, anon, authenticated;

revoke execute on function public.telefonos_por_corregir() from public, anon;
grant execute on function public.telefonos_por_corregir(), public.normalizar_telefono(text), public.es_telefono_e164(text)
  to authenticated;
