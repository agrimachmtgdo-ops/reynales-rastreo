-- =============================================================================
-- Reversión de 20261209000100_roles_comercial.sql
-- Quita el área comercial, el comercial por cliente y la pantalla de usuarios.
-- Los usuarios comerciales quedan como gerencia (solo lectura), sin perder la cuenta.
-- ATENCIÓN: se pierde a qué comercial estaba asignado cada cliente.
-- =============================================================================
begin;
set search_path = public, extensions;

drop function if exists public.registrar_personal(text, text, text);
drop function if exists public.guardar_personal(uuid, text, text, boolean);
drop function if exists public.listar_personal();
drop function if exists public.comerciales();
drop trigger if exists clientes_comercial on public.clientes;
drop function if exists public.trg_clientes_comercial();

drop policy if exists clientes_crear on public.clientes;
drop policy if exists clientes_editar on public.clientes;
create policy clientes_crear on public.clientes for insert to authenticated with check (public.puede_editar());
create policy clientes_editar on public.clientes for update to authenticated
  using (public.puede_editar()) with check (public.puede_editar());

drop function if exists public.perfil_actual();
drop function if exists public.perfil_de(public.rol_personal, text);
drop function if exists public.es_comercial();

drop index if exists public.clientes_comercial_idx;
alter table public.clientes drop column if exists comercial_id;
alter table public.usuarios drop constraint if exists usuarios_comercial_solo_lectura;
alter table public.usuarios drop column if exists area;
commit;
