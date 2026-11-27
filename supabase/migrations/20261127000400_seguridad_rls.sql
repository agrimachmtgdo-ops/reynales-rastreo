-- =============================================================================
-- 4. Seguridad: roles y políticas RLS (Row Level Security)
--
-- Regla general:
--   * Personal activo (administrador, despacho, gerencia) puede LEER todo.
--   * Solo administrador y despacho pueden CREAR o MODIFICAR.
--   * Los choferes (sesión anónima del teléfono) NO leen tablas: todo lo hacen
--     por funciones del servidor que validan su invitación.
--   * Visitantes sin sesión (rol anon) no tienen acceso a ninguna tabla.
-- =============================================================================
set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Funciones auxiliares (security definer para no caer en recursión de RLS)
-- ---------------------------------------------------------------------------
create or replace function public.rol_actual()
returns public.rol_personal language sql stable security definer
set search_path = public as $$
  select rol from public.usuarios where id = auth.uid() and activo
$$;

create or replace function public.es_personal()
returns boolean language sql stable security definer
set search_path = public as $$
  select public.rol_actual() is not null
$$;

create or replace function public.puede_editar()
returns boolean language sql stable security definer
set search_path = public as $$
  select coalesce(public.rol_actual() in ('administrador', 'despacho'), false)
$$;

create or replace function public.es_administrador()
returns boolean language sql stable security definer
set search_path = public as $$
  select coalesce(public.rol_actual() = 'administrador', false)
$$;

-- Cuando alguien se registra con correo (no anónimo) se crea su ficha inactiva.
-- Un administrador decide su rol y la activa.
create or replace function public.al_crear_usuario_auth()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  if coalesce(new.is_anonymous, false) = false then
    insert into public.usuarios (id, nombre, rol, activo)
    values (new.id, coalesce(new.raw_user_meta_data ->> 'nombre', new.email, 'Sin nombre'), 'despacho', false)
    on conflict (id) do nothing;
  end if;
  return new;
end $$;

create trigger al_crear_usuario_auth
  after insert on auth.users
  for each row execute function public.al_crear_usuario_auth();

-- ---------------------------------------------------------------------------
-- Defensa adicional: el rol anon no toca ninguna tabla directamente.
-- (La futura página pública del cliente usará una función del servidor.)
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;

-- ---------------------------------------------------------------------------
-- Activar RLS en todas las tablas
-- ---------------------------------------------------------------------------
alter table public.usuarios              enable row level security;
alter table public.clientes              enable row level security;
alter table public.transportistas        enable row level security;
alter table public.conductores           enable row level security;
alter table public.vehiculos             enable row level security;
alter table public.ubicaciones           enable row level security;
alter table public.misiones              enable row level security;
alter table public.misiones_puntos_ruta  enable row level security;
alter table public.asignaciones          enable row level security;
alter table public.invitaciones_chofer   enable row level security;
alter table public.politicas_rastreo     enable row level security;
alter table public.consentimientos       enable row level security;
alter table public.eventos               enable row level security;
alter table public.documentos            enable row level security;
alter table public.enlaces_seguimiento   enable row level security;
alter table public.descargas_documentos  enable row level security;
alter table public.avisos                enable row level security;
alter table public.posiciones            enable row level security;

-- ---------------------------------------------------------------------------
-- usuarios: cada uno ve su ficha; el administrador ve y edita todas.
-- ---------------------------------------------------------------------------
create policy usuarios_leer on public.usuarios for select to authenticated
  using (id = auth.uid() or public.es_administrador());
create policy usuarios_admin_editar on public.usuarios for update to authenticated
  using (public.es_administrador()) with check (public.es_administrador());

-- ---------------------------------------------------------------------------
-- Tablas operativas: personal lee; administrador y despacho editan.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'clientes', 'transportistas', 'conductores', 'vehiculos', 'ubicaciones',
    'misiones', 'misiones_puntos_ruta', 'asignaciones', 'documentos', 'enlaces_seguimiento'
  ] loop
    execute format('create policy %I on public.%I for select to authenticated using (public.es_personal())', t || '_leer', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.puede_editar())', t || '_crear', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.puede_editar()) with check (public.puede_editar())', t || '_editar', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.puede_editar())', t || '_borrar', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Solo lectura para el personal. Se escriben únicamente por funciones del
-- servidor (que registran quién hizo qué).
-- ---------------------------------------------------------------------------
create policy invitaciones_leer    on public.invitaciones_chofer  for select to authenticated using (public.es_personal());
create policy consentimientos_leer on public.consentimientos      for select to authenticated using (public.es_personal());
create policy eventos_leer         on public.eventos              for select to authenticated using (public.es_personal());
create policy descargas_leer       on public.descargas_documentos for select to authenticated using (public.es_personal());
create policy avisos_leer          on public.avisos               for select to authenticated using (public.es_personal());
create policy posiciones_leer      on public.posiciones           for select to authenticated using (public.es_personal());

-- Política de rastreo: el personal la lee; el administrador la mantiene.
create policy politicas_leer on public.politicas_rastreo for select to authenticated using (public.es_personal());
create policy politicas_admin on public.politicas_rastreo for all to authenticated
  using (public.es_administrador()) with check (public.es_administrador());

-- Funciones auxiliares: no se exponen a visitantes anónimos.
revoke execute on function public.rol_actual(), public.es_personal(), public.puede_editar(), public.es_administrador()
  from public, anon;
grant execute on function public.rol_actual(), public.es_personal(), public.puede_editar(), public.es_administrador()
  to authenticated;
revoke execute on function public.al_crear_usuario_auth(), public.crear_particiones_posiciones(date, int),
  public.cerrar_particion(text), public.tocar_actualizado_en()
  from public, anon, authenticated;
