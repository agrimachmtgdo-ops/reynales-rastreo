-- Reversión de 20261215000100_envio_completo.sql: vuelve a la regla anterior
-- (envío «cumplido» apenas su misión está entregada) y recalcula los estados.
set search_path = public, extensions;

drop trigger if exists asignaciones_estado_envio on public.asignaciones;
drop trigger if exists programa_envios_necesarios on public.programa_envios;
drop function if exists public.trg_asignacion_estado_envio();
drop function if exists public.trg_envio_necesarios();

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
    when v_etapa = 'entregado' then 'cumplido'
    else 'en_curso'
  end;
  if nuevo <> e.estado then
    update public.programa_envios set estado = nuevo where id = p_envio;
  end if;
  perform public.recalcular_estado_pedido(e.pedido_id);
end $$;

drop function if exists public.envio_cubierto(uuid);

do $$
declare r record;
begin
  for r in select id from public.programa_envios where estado in ('en_curso', 'cumplido') loop
    perform public.recalcular_estado_envio(r.id);
  end loop;
end $$;
