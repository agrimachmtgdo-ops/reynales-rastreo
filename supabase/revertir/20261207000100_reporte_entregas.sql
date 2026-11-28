-- =============================================================================
-- Reversión de 20261207000100_reporte_entregas.sql
-- Quita la función de reporte y el campo «Entrega comprometida».
-- ATENCIÓN: se pierden las fechas comprometidas que se hayan cargado.
-- =============================================================================
begin;
drop function if exists public.reporte_entregas(date, date, uuid, text, uuid);
alter table public.misiones drop column if exists entrega_comprometida;
commit;
