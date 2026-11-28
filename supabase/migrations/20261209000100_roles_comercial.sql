-- =============================================================================
-- Fase C1: roles y usuarios (plan de pedidos, versión 2 aprobada el 2026-11-28)
--
--  * usuarios.area (opcional): por ahora solo 'comercial'. Un comercial tiene
--    rol 'gerencia' (solo lectura en todo lo actual) más esta marca, que le abre
--    solo la tabla de clientes (y, en la fase C2, los pedidos).
--  * clientes.comercial_id: el comercial responsable del cliente. Solo el
--    administrador lo cambia.
--  * Perfil que ve la gente: administrador, logística (= rol despacho),
--    gerencia o comercial. NO se agregan valores al enum rol_personal y las
--    políticas existentes que usan puede_editar() no se tocan.
--  * Funciones para la pantalla de usuarios (solo administrador): listar,
--    registrar una cuenta como personal y cambiar perfil o estado, sin poder
--    quitarse a sí mismo ni dejar el sistema sin administrador activo.
--
-- No borra ni modifica datos existentes. Reversión:
-- supabase/revertir/20261209000100_roles_comercial.sql
-- =============================================================================
set search_path = public, extensions;

alter table public.usuarios
  add column area text check (area is null or area = 'comercial'),
  add constraint usuarios_comercial_solo_lectura check (area is null or rol = 'gerencia');
comment on column public.usuarios.area is
  'Área de trabajo. ''comercial'' = rol gerencia (solo lectura) + edición de clientes y pedidos.';

alter table public.clientes
  add column comercial_id uuid references public.usuarios (id) on delete set null;
create index clientes_comercial_idx on public.clientes (comercial_id);

-- ---------------------------------------------------------------------------
-- Funciones auxiliares
-- ---------------------------------------------------------------------------
create or replace function public.es_comercial()
returns boolean language sql stable security definer
set search_path = public as $$
  select exists (select 1 from public.usuarios where id = auth.uid() and activo and area = 'comercial')
$$;

-- Perfil con el nombre que ve la gente (null si no es personal activo).
create or replace function public.perfil_de(p_rol public.rol_personal, p_area text)
returns text language sql immutable
set search_path = public as $$
  select case when p_area = 'comercial' then 'comercial'
              when p_rol = 'despacho' then 'logistica'
              else p_rol::text end
$$;

create or replace function public.perfil_actual()
returns text language sql stable security definer
set search_path = public as $$
  select public.perfil_de(rol, area) from public.usuarios where id = auth.uid() and activo
$$;

-- ---------------------------------------------------------------------------
-- Clientes: el comercial también crea y edita (no borra)
-- ---------------------------------------------------------------------------
drop policy clientes_crear on public.clientes;
drop policy clientes_editar on public.clientes;
create policy clientes_crear on public.clientes for insert to authenticated
  with check (public.puede_editar() or public.es_comercial());
create policy clientes_editar on public.clientes for update to authenticated
  using (public.puede_editar() or public.es_comercial())
  with check (public.puede_editar() or public.es_comercial());

-- Solo el administrador asigna o cambia el comercial responsable.
create or replace function public.trg_clientes_comercial()
returns trigger language plpgsql security definer
set search_path = public as $$
declare
  cambio boolean := case when tg_op = 'INSERT' then new.comercial_id is not null
                         else new.comercial_id is distinct from old.comercial_id end;
begin
  if cambio then
    if not public.es_administrador() and auth.uid() is not null then
      raise exception 'Solo un administrador asigna el comercial de un cliente.' using errcode = '42501';
    end if;
    if new.comercial_id is not null
       and not exists (select 1 from public.usuarios where id = new.comercial_id and activo and area = 'comercial') then
      raise exception 'Elija un usuario activo del área comercial.';
    end if;
  end if;
  return new;
end $$;
create trigger clientes_comercial
  before insert or update of comercial_id on public.clientes
  for each row execute function public.trg_clientes_comercial();

-- Lista de comerciales activos (para elegir el responsable de un cliente).
create or replace function public.comerciales()
returns table (id uuid, nombre text) language sql stable security definer
set search_path = public as $$
  select u.id, u.nombre from public.usuarios u
   where u.activo and u.area = 'comercial' and public.es_personal()
   order by u.nombre
$$;

-- ---------------------------------------------------------------------------
-- Pantalla de usuarios (solo administrador)
-- ---------------------------------------------------------------------------
create or replace function public.listar_personal()
returns table (id uuid, nombre text, correo text, perfil text, activo boolean, creado_en timestamptz,
               ultimo_ingreso timestamptz, clientes_asignados bigint)
language plpgsql stable security definer
set search_path = public as $$
begin
  if not public.es_administrador() then
    raise exception 'Solo un administrador ve la lista de usuarios.' using errcode = '42501';
  end if;
  return query
    select u.id, u.nombre, a.email::text, public.perfil_de(u.rol, u.area), u.activo, u.creado_en, a.last_sign_in_at,
           (select count(*) from public.clientes c where c.comercial_id = u.id)
      from public.usuarios u join auth.users a on a.id = u.id
     order by u.activo desc, u.nombre;
end $$;

-- Cambia perfil, nombre y estado de una ficha de personal.
create or replace function public.guardar_personal(p_usuario uuid, p_nombre text, p_perfil text, p_activo boolean)
returns void language plpgsql security definer
set search_path = public as $$
declare
  v_rol public.rol_personal;
  v_area text;
begin
  if not public.es_administrador() then
    raise exception 'Solo un administrador cambia usuarios.' using errcode = '42501';
  end if;
  if coalesce(trim(p_nombre), '') = '' then
    raise exception 'Escriba el nombre.';
  end if;
  case p_perfil
    when 'administrador' then v_rol := 'administrador'; v_area := null;
    when 'logistica'     then v_rol := 'despacho';      v_area := null;
    when 'gerencia'      then v_rol := 'gerencia';      v_area := null;
    when 'comercial'     then v_rol := 'gerencia';      v_area := 'comercial';
    else raise exception 'Elija un perfil válido.';
  end case;
  if not exists (select 1 from public.usuarios where id = p_usuario) then
    raise exception 'No existe ese usuario.';
  end if;
  if p_usuario = auth.uid() and (v_rol <> 'administrador' or not p_activo) then
    raise exception 'No puede quitarse a sí mismo el perfil de administrador ni desactivarse. Pídaselo a otro administrador.';
  end if;
  update public.usuarios
     set nombre = trim(p_nombre), rol = v_rol, area = v_area, activo = p_activo
   where id = p_usuario;
  if not exists (select 1 from public.usuarios where rol = 'administrador' and activo) then
    raise exception 'Debe quedar al menos un administrador activo.';
  end if;
  -- Un cliente no queda asignado a alguien que ya no es comercial activo.
  if v_area is distinct from 'comercial' or not p_activo then
    update public.clientes set comercial_id = null where comercial_id = p_usuario;
  end if;
end $$;

-- Convierte una cuenta creada en Supabase (Authentication → Add user) en personal activo.
create or replace function public.registrar_personal(p_correo text, p_nombre text, p_perfil text)
returns uuid language plpgsql security definer
set search_path = public as $$
declare
  usuario uuid;
begin
  if not public.es_administrador() then
    raise exception 'Solo un administrador registra usuarios.' using errcode = '42501';
  end if;
  select id into usuario from auth.users
   where lower(email) = lower(trim(p_correo)) and not coalesce(is_anonymous, false);
  if usuario is null then
    raise exception 'No existe una cuenta con el correo %. Créela primero en Supabase (Authentication → Add user, con «Auto Confirm User»).', trim(p_correo);
  end if;
  if exists (select 1 from public.operadores_transbordo where user_id = usuario) then
    raise exception 'Ese correo es de un operador de transbordo. Use otro correo para el personal.';
  end if;
  insert into public.usuarios (id, nombre, rol, activo)
  values (usuario, trim(p_nombre), 'gerencia', false)
  on conflict (id) do nothing;
  perform public.guardar_personal(usuario, p_nombre, p_perfil, true);
  return usuario;
end $$;

revoke execute on function public.es_comercial(), public.perfil_actual(), public.comerciales(),
  public.listar_personal(), public.guardar_personal(uuid, text, text, boolean),
  public.registrar_personal(text, text, text), public.trg_clientes_comercial()
  from public, anon;
grant execute on function public.es_comercial(), public.perfil_actual(), public.comerciales(),
  public.listar_personal(), public.guardar_personal(uuid, text, text, boolean),
  public.registrar_personal(text, text, text)
  to authenticated;
