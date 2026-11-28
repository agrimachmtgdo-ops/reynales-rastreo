-- =============================================================================
-- Corregir la fecha de carga de un envío confirmado (pedido de Ronald 2026-11-28)
--
--  * Un envío confirmado podía cambiar su fecha de ENTREGA (reprogramar), pero no
--    su fecha de CARGA en fábrica, que es la que usa el programa de despachos y
--    el semáforo de camiones.
--  * cambiar_fecha_carga(envío, fecha, causa, nota): la cambia mientras el envío
--    está confirmado y pendiente (aún no salió). No mueve el compromiso con el
--    cliente. Queda en el historial como tipo «carga», con causa.
--
-- No borra ni modifica datos existentes. Reversión: supabase/revertir/20261213000100_fecha_carga.sql
-- =============================================================================
set search_path = public, extensions;

alter table public.cambios_compromiso drop constraint cambios_compromiso_tipo_check;
alter table public.cambios_compromiso add constraint cambios_compromiso_tipo_check
  check (tipo in ('reprogramado', 'cancelado', 'carga'));

create or replace function public.cambiar_fecha_carga(p_envio uuid, p_fecha date, p_causa text, p_nota text default null)
returns void language plpgsql security definer
set search_path = public as $$
declare
  e public.programa_envios;
  p public.pedidos;
begin
  select * into e from public.programa_envios where id = p_envio for update;
  if e.id is null then raise exception 'No existe ese envío.'; end if;
  select * into p from public.pedidos where id = e.pedido_id;
  if not public.puede_programar(p.cliente_id) then
    raise exception 'Solo el administrador, el comercial del cliente o logística cambian la fecha de carga.' using errcode = '42501';
  end if;
  if e.estado <> 'pendiente' then
    raise exception 'Solo se corrige la fecha de carga de un envío confirmado que aún no salió. Un envío planificado se cambia en el programa.';
  end if;
  if p_fecha is null then raise exception 'Elija la nueva fecha de carga.'; end if;
  if p_fecha > e.entrega_vigente then
    raise exception 'La fecha de carga no puede ser posterior a la entrega (%). Si la entrega también cambia, reprograme primero.', to_char(e.entrega_vigente, 'DD/MM/YYYY');
  end if;
  if p_fecha is not distinct from e.fecha_carga_planificada then
    raise exception 'No hay cambios: la fecha de carga es la misma.';
  end if;
  if p_causa is null or p_causa not in ('cliente', 'produccion', 'transporte', 'aduana', 'clima_via', 'otra') then
    raise exception 'Elija la causa del cambio.';
  end if;
  if p_causa = 'otra' and coalesce(trim(p_nota), '') = '' then
    raise exception 'Con la causa «Otra», escriba una nota que explique el cambio.';
  end if;
  insert into public.cambios_compromiso (envio_id, tipo, fecha_anterior, fecha_nueva, causa, nota, mueve_compromiso)
  values (p_envio, 'carga', e.fecha_carga_planificada, p_fecha, p_causa, nullif(trim(coalesce(p_nota, '')), ''), false);
  update public.programa_envios set fecha_carga_planificada = p_fecha where id = p_envio;
  update public.pedidos set actualizado_en = now() where id = p.id;
end $$;

revoke execute on function public.cambiar_fecha_carga(uuid, date, text, text) from public, anon;
grant execute on function public.cambiar_fecha_carga(uuid, date, text, text) to authenticated;
