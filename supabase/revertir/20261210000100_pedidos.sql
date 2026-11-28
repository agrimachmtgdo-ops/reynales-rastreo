-- =============================================================================
-- Reversión de 20261210000100_pedidos.sql
-- Quita pedidos, programa de envíos e historial de cambios.
-- ATENCIÓN: se pierden los pedidos cargados. Si hay alguno, exporte antes la lista
-- (Pedidos → Exportar CSV) o descarte la reversión.
-- =============================================================================
begin;
drop function if exists public.cancelar_pedido(uuid, text);
drop function if exists public.cancelar_envio(uuid, text, text);
drop function if exists public.reprogramar_envio(uuid, date, numeric, text, text);
drop function if exists public.confirmar_pedido(uuid);
drop function if exists public.guardar_pedido(uuid, jsonb, jsonb);
drop function if exists public.puede_editar_pedidos(uuid);
drop table if exists public.cambios_compromiso;
drop table if exists public.programa_envios;
drop table if exists public.pedidos;
commit;
