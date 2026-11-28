-- Producto parametrizable: catálogo de productos y enlace desde pedidos y misiones.
-- No borra ni cambia los textos existentes (pedidos.producto, misiones.tipo_carga):
-- se agrega producto_id y un disparador mantiene ambos coherentes.
-- Reversión: supabase/revertir/20261216000100_productos.sql
set search_path = public, extensions;

create table public.productos (
  id                 uuid primary key default gen_random_uuid(),
  nombre             text not null check (length(btrim(nombre)) between 1 and 120),
  codigo             text check (codigo is null or length(btrim(codigo)) between 1 and 30),
  presentacion       text check (presentacion is null or length(btrim(presentacion)) between 1 and 60),
  partida_arancelaria text check (partida_arancelaria is null or partida_arancelaria ~ '^[0-9.]{4,14}$'),
  activo             boolean not null default true,
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now()
);
comment on table public.productos is 'Catálogo de productos transportados (para elegir en pedidos y misiones y para los reportes).';
comment on column public.productos.partida_arancelaria is 'Partida arancelaria NANDINA (solo dígitos y puntos), útil para exportación.';
create unique index productos_nombre_unico on public.productos (lower(btrim(nombre)));
create unique index productos_codigo_unico on public.productos (lower(btrim(codigo))) where codigo is not null;
create trigger productos_actualizado before update on public.productos
  for each row execute function public.tocar_actualizado_en();

alter table public.productos enable row level security;
create policy productos_leer   on public.productos for select to authenticated using (public.es_personal());
create policy productos_crear  on public.productos for insert to authenticated with check (public.puede_editar());
create policy productos_editar on public.productos for update to authenticated
  using (public.puede_editar()) with check (public.puede_editar());
-- Sin política de borrado: un producto usado no se borra, se desactiva.
revoke all on public.productos from anon;

alter table public.pedidos  add column producto_id uuid references public.productos (id) on delete restrict;
alter table public.misiones add column producto_id uuid references public.productos (id) on delete restrict;
create index pedidos_producto_idx  on public.pedidos (producto_id);
create index misiones_producto_idx on public.misiones (producto_id);

-- Mantiene coherentes el texto y el enlace:
--  * si llega producto_id, el texto toma el nombre del catálogo;
--  * si solo llega el texto, se enlaza con el producto activo de igual nombre (si existe)
--    y el texto queda escrito como en el catálogo;
--  * una misión de un envío sin producto hereda el del pedido.
create or replace function public.trg_producto_pedido()
returns trigger language plpgsql security definer
set search_path = public as $$
declare v_nombre text;
begin
  -- Si cambió solo el texto, el enlace anterior deja de valer y se busca de nuevo por nombre.
  if tg_op = 'UPDATE' and new.producto_id is not distinct from old.producto_id
     and new.producto is distinct from old.producto then
    new.producto_id := null;
  end if;
  if new.producto_id is not null then
    select nombre into v_nombre from public.productos where id = new.producto_id;
    if v_nombre is null then raise exception 'El producto elegido no existe.'; end if;
    new.producto := v_nombre;
  elsif new.producto is not null then
    select id, nombre into new.producto_id, v_nombre from public.productos
     where activo and lower(btrim(nombre)) = lower(btrim(new.producto)) limit 1;
    if v_nombre is not null then new.producto := v_nombre; end if;
  end if;
  return new;
end $$;

create or replace function public.trg_producto_mision()
returns trigger language plpgsql security definer
set search_path = public as $$
declare v_nombre text;
begin
  if tg_op = 'UPDATE' and new.producto_id is not distinct from old.producto_id
     and new.tipo_carga is distinct from old.tipo_carga then
    new.producto_id := null;
  end if;
  if new.producto_id is null and new.envio_id is not null and (tg_op = 'INSERT' or new.envio_id is distinct from old.envio_id) then
    select p.producto_id into new.producto_id
      from public.programa_envios e join public.pedidos p on p.id = e.pedido_id
     where e.id = new.envio_id;
  end if;
  if new.producto_id is not null then
    select nombre into v_nombre from public.productos where id = new.producto_id;
    if v_nombre is null then raise exception 'El producto elegido no existe.'; end if;
    new.tipo_carga := v_nombre;
  elsif new.tipo_carga is not null then
    select id, nombre into new.producto_id, v_nombre from public.productos
     where activo and lower(btrim(nombre)) = lower(btrim(new.tipo_carga)) limit 1;
    if v_nombre is not null then new.tipo_carga := v_nombre; end if;
  end if;
  return new;
end $$;

create trigger pedidos_producto before insert or update of producto, producto_id on public.pedidos
  for each row execute function public.trg_producto_pedido();
create trigger misiones_producto before insert or update of tipo_carga, producto_id, envio_id on public.misiones
  for each row execute function public.trg_producto_mision();
revoke execute on function public.trg_producto_pedido(), public.trg_producto_mision() from public, anon, authenticated;

-- Producto inicial y enlace de los registros que dicen exactamente «Harina Integral».
insert into public.productos (nombre) values ('Harina Integral')
  on conflict do nothing;
update public.pedidos  set producto_id = (select id from public.productos where nombre = 'Harina Integral')
 where producto_id is null and producto = 'Harina Integral';
update public.misiones set producto_id = (select id from public.productos where nombre = 'Harina Integral')
 where producto_id is null and tipo_carga = 'Harina Integral';
