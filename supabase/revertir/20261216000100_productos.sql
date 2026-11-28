-- Reversión de 20261216000100_productos.sql: quita el catálogo y los enlaces.
-- Los textos pedidos.producto y misiones.tipo_carga se conservan tal como están.
set search_path = public, extensions;

drop trigger if exists pedidos_producto on public.pedidos;
drop trigger if exists misiones_producto on public.misiones;
drop function if exists public.trg_producto_pedido();
drop function if exists public.trg_producto_mision();
alter table public.pedidos  drop column if exists producto_id;
alter table public.misiones drop column if exists producto_id;
drop table if exists public.productos;
