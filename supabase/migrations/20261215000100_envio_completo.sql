-- =============================================================================
-- Un envío queda «cumplido» solo cuando se entregó COMPLETO.
--
-- Antes: el envío pasaba a «cumplido» apenas su misión llegaba a «entregado»,
-- aunque se hubiera entregado 1 camión de los 5 que necesita (caso PED-UCQGZM
-- envío 1). Eso además cerraba el envío y ya no se podían cargar más camiones.
--
-- Ahora el envío queda «cumplido» cuando su misión está entregada Y además:
--  * salieron al menos los camiones necesarios del envío (primer tramo; si logística
--    no los fijó, los estimados por toneladas, igual que en el Programa), o
--  * con menos camiones, el peso registrado cubre las toneladas del envío, con la
--    tolerancia de cumplimiento (otif_tolerancia_pct, 3 %).
-- Si no, queda «en curso» (entrega parcial) y se pueden cargar los camiones que
-- faltan. Se recalcula al cambiar camiones, pesos o camiones necesarios.
--
-- Recalcula una vez el estado de los envíos en curso o cumplidos (es un dato
-- calculado, no un dato cargado por el usuario). No borra datos.
-- Reversión: supabase/revertir/20261215000100_envio_completo.sql
-- =============================================================================
set search_path = public, extensions;

-- ¿Lo entregado cubre el envío? (camiones vivos del tramo 1, ya entregados o en viaje)
create or replace function public.envio_cubierto(p_envio uuid)
returns boolean language plpgsql stable security definer
set search_path = public as $$
declare
  e public.programa_envios;
  v_mision uuid := public.mision_de_envio(p_envio);
  v_camiones int;
  v_sin_peso int;
  v_toneladas numeric;
  v_tol numeric;
begin
  select * into e from public.programa_envios where id = p_envio;
  if e.id is null or v_mision is null then return false; end if;
  select count(*), count(*) filter (where toneladas_cargadas is null), coalesce(sum(toneladas_cargadas), 0)
    into v_camiones, v_sin_peso, v_toneladas
    from public.asignaciones
   where mision_id = v_mision and tramo = 1 and etapa <> 'cancelado';
  if v_camiones = 0 then return false; end if;
  -- Salieron todos los camiones necesarios (si faltó peso en alguno, el cumplimiento lo marca «incompleto»).
  if v_camiones >= coalesce(e.camiones_necesarios, public.camiones_estimados(e.toneladas), 1) then return true; end if;
  -- Menos camiones, pero con peso registrado que cubre las toneladas del envío.
  if v_sin_peso = 0 and e.toneladas is not null then
    select coalesce((select (valor #>> '{}')::numeric from public.configuracion where clave = 'otif_tolerancia_pct'), 3) into v_tol;
    return v_toneladas >= e.toneladas * (1 - v_tol / 100);
  end if;
  return false;
end $$;

create or replace function public.recalcular_estado_envio(p_envio uuid)
returns void language plpgsql security definer
set search_path = public as $$
declare
  e public.programa_envios;
  v_etapa public.etapa_envio;
  nuevo text;
begin
  select * into e from public.programa_envios where id = p_envio for update;
  if e.id is null or e.estado not in ('pendiente', 'en_curso', 'cumplido') then return; end if;
  select etapa into v_etapa from public.misiones where id = public.mision_de_envio(p_envio);
  nuevo := case
    when v_etapa is null or v_etapa = 'programado' then 'pendiente'
    when v_etapa = 'entregado' and public.envio_cubierto(p_envio) then 'cumplido'
    else 'en_curso'
  end;
  if nuevo <> e.estado then
    update public.programa_envios set estado = nuevo where id = p_envio;
  end if;
  perform public.recalcular_estado_pedido(e.pedido_id);
end $$;

-- Cambios en los camiones de la misión (alta, baja, peso, etapa, tramo).
create or replace function public.trg_asignacion_estado_envio()
returns trigger language plpgsql security definer
set search_path = public as $$
declare
  v_envio uuid;
begin
  for v_envio in
    select distinct m.envio_id from public.misiones m
     where m.envio_id is not null
       and m.id in (coalesce(new.mision_id, old.mision_id), coalesce(old.mision_id, new.mision_id))
  loop
    perform public.recalcular_estado_envio(v_envio);
  end loop;
  return null;
end $$;

create trigger asignaciones_estado_envio
  after insert or delete or update of etapa, toneladas_cargadas, tramo, mision_id on public.asignaciones
  for each row execute function public.trg_asignacion_estado_envio();

-- Cambio de camiones necesarios o de toneladas del envío.
create or replace function public.trg_envio_necesarios()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  perform public.recalcular_estado_envio(new.id);
  return null;
end $$;

create trigger programa_envios_necesarios
  after update of camiones_necesarios, toneladas on public.programa_envios
  for each row
  when (new.camiones_necesarios is distinct from old.camiones_necesarios or new.toneladas is distinct from old.toneladas)
  execute function public.trg_envio_necesarios();

revoke execute on function public.envio_cubierto(uuid), public.trg_asignacion_estado_envio(), public.trg_envio_necesarios()
  from public, anon, authenticated;

-- Corrige los envíos ya marcados (por ejemplo, entregas parciales que figuraban «cumplido»).
do $$
declare r record;
begin
  for r in select id from public.programa_envios where estado in ('en_curso', 'cumplido') loop
    perform public.recalcular_estado_envio(r.id);
  end loop;
end $$;
