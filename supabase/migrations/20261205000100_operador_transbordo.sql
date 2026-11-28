-- =============================================================================
-- Operador de transbordo (El Alto).
-- La empresa que recibe la carga en el transbordo entra a /transbordo desde el
-- celular: registra sus camiones y choferes del tramo siguiente, confirma que
-- recibió la carga y sube el CRT, el MIC/DTA y fotos.
--
--  * Tabla "operadores_transbordo": la cuenta (correo y contraseña creados por el
--    administrador) enlazada a UNA empresa de transporte. No va en "usuarios":
--    el personal lee todo, el operador solo lo suyo, por funciones del servidor.
--  * asignaciones.precinto (obligatorio cuando lo registra el operador).
--  * documentos: camión, número, quién subió (operador) y reemplazo (versiones:
--    nada se borra). Bucket privado "documentos" con permisos por misión.
--  * Alerta para despacho si un camión del tramo 2 o 3 sale hacia Perú sin
--    CRT o MIC/DTA (no bloquea el viaje).
--
-- No borra ni modifica datos existentes. No cambia los tipos (enum) existentes.
-- Reversión: supabase/revertir/20261205000100_operador_transbordo.sql
-- =============================================================================
set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Cuentas de operador
-- ---------------------------------------------------------------------------
create table public.operadores_transbordo (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null unique references auth.users (id) on delete cascade,
  transportista_id  uuid not null references public.transportistas (id) on delete restrict,
  nombre            text not null,
  correo            text,
  telefono          text,
  activo            boolean not null default true,
  creado_por        uuid references public.usuarios (id) default auth.uid(),
  creado_en         timestamptz not null default now()
);
comment on table public.operadores_transbordo is
  'Empresa o encargado del transbordo (El Alto). Solo ve las misiones donde su empresa hace un tramo.';
alter table public.operadores_transbordo enable row level security;
create policy operadores_leer   on public.operadores_transbordo for select to authenticated using (public.es_personal());
create policy operadores_editar on public.operadores_transbordo for update to authenticated
  using (public.es_administrador()) with check (public.es_administrador());

-- Operador activo de la sesión actual (null si no es operador).
create or replace function public.operador_actual()
returns public.operadores_transbordo language sql stable security definer
set search_path = public as $$
  select o.* from public.operadores_transbordo o where o.user_id = auth.uid() and o.activo
$$;

-- Tramo que hace la empresa del operador en esa misión (null = sin acceso).
create or replace function public.operador_tramo_de(p_mision uuid)
returns smallint language sql stable security definer
set search_path = public as $$
  select max(t.numero)::smallint
    from public.tramos t
    join public.operadores_transbordo o on o.transportista_id = t.transportista_id
   where t.mision_id = p_mision and o.user_id = auth.uid() and o.activo
$$;

-- Misión a la que pertenece un archivo del bucket (la primera carpeta de la ruta).
create or replace function public.mision_de_ruta(p_ruta text)
returns uuid language sql immutable
set search_path = public as $$
  select case when split_part(p_ruta, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then split_part(p_ruta, '/', 1)::uuid end
$$;

-- Una cuenta de operador nunca puede activarse como personal (vería todo).
create or replace function public.trg_usuario_no_operador()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  if new.activo and exists (select 1 from public.operadores_transbordo where user_id = new.id) then
    raise exception 'Esta cuenta es de un operador de transbordo: no puede activarse como personal de la fábrica.';
  end if;
  return new;
end $$;
create trigger usuarios_no_operador
  before insert or update of activo on public.usuarios
  for each row execute function public.trg_usuario_no_operador();

-- ADMINISTRADOR: convierte una cuenta creada en Supabase (Authentication → Add user)
-- en operador de una empresa de transporte.
create or replace function public.registrar_operador(
  p_correo text, p_nombre text, p_transportista uuid, p_telefono text default null
) returns uuid language plpgsql security definer
set search_path = public as $$
declare
  usuario uuid;
  nuevo uuid;
begin
  if not public.es_administrador() then
    raise exception 'Solo un administrador puede crear operadores de transbordo.' using errcode = '42501';
  end if;
  if coalesce(trim(p_nombre), '') = '' then
    raise exception 'Escriba el nombre del operador.';
  end if;
  select id into usuario from auth.users
   where lower(email) = lower(trim(p_correo)) and not coalesce(is_anonymous, false);
  if usuario is null then
    raise exception 'No existe una cuenta con el correo %. Créela primero en Supabase (Authentication → Add user, con «Auto Confirm User»).', trim(p_correo);
  end if;
  if exists (select 1 from public.usuarios where id = usuario and activo) then
    raise exception 'Ese correo es de personal activo de la fábrica. Use otro correo para el operador.';
  end if;
  if not exists (select 1 from public.transportistas where id = p_transportista) then
    raise exception 'Elija la empresa de transporte del operador.';
  end if;
  insert into public.operadores_transbordo (user_id, transportista_id, nombre, correo, telefono)
  values (usuario, p_transportista, trim(p_nombre), lower(trim(p_correo)), nullif(trim(coalesce(p_telefono, '')), ''))
  returning id into nuevo;
  return nuevo;
exception when unique_violation then
  raise exception 'Esa cuenta ya es operador de transbordo.';
end $$;

-- Datos de la sesión para la página (null si no es operador activo).
create or replace function public.mi_operador()
returns jsonb language sql stable security definer
set search_path = public as $$
  select jsonb_build_object('nombre', o.nombre, 'empresa', t.razon_social)
    from public.operadores_transbordo o join public.transportistas t on t.id = o.transportista_id
   where o.user_id = auth.uid() and o.activo
$$;

-- ---------------------------------------------------------------------------
-- Columnas nuevas
-- ---------------------------------------------------------------------------
alter table public.asignaciones
  add column precinto text check (precinto is null or length(precinto) <= 60);

alter table public.documentos
  add column asignacion_id uuid references public.asignaciones (id) on delete cascade,
  add column numero text check (numero is null or length(numero) <= 60),
  add column subido_por_operador uuid references public.operadores_transbordo (id) on delete set null,
  add column reemplazado_por uuid references public.documentos (id) on delete set null,
  add column tipo_mime text,
  add column tamano_bytes integer check (tamano_bytes is null or tamano_bytes between 1 and 10485760);
create index documentos_mision_idx on public.documentos (mision_id, creado_en desc);
create index documentos_asignacion_idx on public.documentos (asignacion_id) where asignacion_id is not null;

-- El camión de un documento debe ser de la misma misión; la ruta debe estar en la carpeta de la misión.
create or replace function public.trg_validar_documento()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  if new.asignacion_id is not null
     and not exists (select 1 from public.asignaciones where id = new.asignacion_id and mision_id = new.mision_id) then
    raise exception 'El camión no pertenece a esta misión.';
  end if;
  if public.mision_de_ruta(new.ruta_archivo) is distinct from new.mision_id then
    raise exception 'La ruta del archivo no corresponde a la misión.';
  end if;
  return new;
end $$;
create trigger documentos_validar
  before insert or update of mision_id, asignacion_id, ruta_archivo on public.documentos
  for each row execute function public.trg_validar_documento();

-- ---------------------------------------------------------------------------
-- Almacenamiento: bucket privado "documentos" (10 MB por archivo, PDF o foto).
-- Ruta: <id de la misión>/<nombre aleatorio>. Nadie borra ni reemplaza archivos.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documentos', 'documentos', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy documentos_archivo_leer on storage.objects for select to authenticated
  using (bucket_id = 'documentos'
         and (public.es_personal() or public.operador_tramo_de(public.mision_de_ruta(name)) is not null));
create policy documentos_archivo_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'documentos'
              and (public.puede_editar() or public.operador_tramo_de(public.mision_de_ruta(name)) is not null));

-- ---------------------------------------------------------------------------
-- Invitación del chofer (uso interno; la de despacho sigue igual).
-- ---------------------------------------------------------------------------
create or replace function public.emitir_invitacion(p_asignacion uuid, p_horas int default 72)
returns table (codigo text, vence_en timestamptz)
language plpgsql security definer
set search_path = public as $$
declare
  asg record;
  nuevo text;
begin
  select id, conductor_id, etapa into asg from public.asignaciones where id = p_asignacion;
  if asg.id is null then
    raise exception 'Asignación no encontrada' using errcode = 'P0002';
  end if;
  if asg.etapa in ('entregado', 'cancelado') then
    raise exception 'El viaje de este camión ya está cerrado.';
  end if;
  update public.invitaciones_chofer set revocada = true where asignacion_id = p_asignacion and not revocada;
  loop
    nuevo := public.generar_codigo(8);
    exit when not exists (select 1 from public.invitaciones_chofer i where i.codigo = nuevo);
  end loop;
  insert into public.invitaciones_chofer (asignacion_id, conductor_id, codigo, vence_en, creado_por)
  values (p_asignacion, asg.conductor_id, nuevo, now() + make_interval(hours => p_horas), null);
  return query select nuevo, now() + make_interval(hours => p_horas);
end $$;

-- ---------------------------------------------------------------------------
-- Funciones del operador (todas validan que la misión sea de su empresa)
-- ---------------------------------------------------------------------------
create or replace function public.exigir_operador()
returns public.operadores_transbordo language plpgsql stable security definer
set search_path = public as $$
declare
  o public.operadores_transbordo;
begin
  select * into o from public.operador_actual();
  if o.id is null then
    raise exception 'Su cuenta no está habilitada como operador de transbordo.' using errcode = '42501';
  end if;
  return o;
end $$;

-- Documentos vigentes (no reemplazados) de una misión, con el camión.
create or replace function public.documentos_vigentes(p_mision uuid)
returns jsonb language sql stable security definer
set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'tipo', d.tipo, 'numero', d.numero, 'nombre', d.nombre_original,
           'ruta', d.ruta_archivo, 'asignacion_id', d.asignacion_id, 'placa', v.placa,
           'tipo_mime', d.tipo_mime, 'creado_en', d.creado_en,
           'subido_por', coalesce(o.nombre, u.nombre)
         ) order by d.creado_en desc), '[]'::jsonb)
    from public.documentos d
    left join public.asignaciones a on a.id = d.asignacion_id
    left join public.vehiculos v on v.id = a.vehiculo_id
    left join public.operadores_transbordo o on o.id = d.subido_por_operador
    left join public.usuarios u on u.id = d.subido_por and d.subido_por_operador is null
   where d.mision_id = p_mision and d.reemplazado_por is null
$$;

-- Lista de cargas del operador: misiones abiertas (y las entregadas en los últimos 7 días).
create or replace function public.operador_mis_cargas()
returns jsonb language plpgsql stable security definer
set search_path = public as $$
declare
  o public.operadores_transbordo := public.exigir_operador();
begin
  return (
    select coalesce(jsonb_agg(x.fila order by x.orden desc), '[]'::jsonb)
      from (
        select m.creado_en as orden, jsonb_build_object(
                 'id', m.id, 'codigo', m.codigo, 'etapa', m.etapa, 'tramo', t.numero,
                 'lugar', t.lugar_inicio, 'cliente', c.razon_social,
                 'destino', d.nombre || coalesce(' (' || d.ciudad || ')', ''),
                 'llegan', (select count(*) from public.asignaciones a
                             where a.mision_id = m.id and a.tramo = t.numero - 1 and a.etapa <> 'cancelado'),
                 'recibidos', (select count(*) from public.asignaciones a
                                where a.mision_id = m.id and a.tramo = t.numero - 1 and a.etapa = 'entregado'),
                 'mis_camiones', (select count(*) from public.asignaciones a
                                   where a.mision_id = m.id and a.tramo = t.numero and a.etapa <> 'cancelado')
               ) as fila
          from public.tramos t
          join public.misiones m on m.id = t.mision_id
          join public.clientes c on c.id = m.cliente_id
          join public.ubicaciones d on d.id = m.destino_id
         where t.transportista_id = o.transportista_id
           and m.etapa <> 'cancelado'
           and (m.etapa <> 'entregado' or m.actualizado_en > now() - interval '7 days')
      ) x
  );
end $$;

-- Detalle de una carga para el operador.
create or replace function public.operador_carga(p_mision uuid)
returns jsonb language plpgsql stable security definer
set search_path = public as $$
declare
  o public.operadores_transbordo := public.exigir_operador();
  v_tramo smallint := public.operador_tramo_de(p_mision);
  resultado jsonb;
begin
  if v_tramo is null then
    raise exception 'Esta carga no está asignada a su empresa.' using errcode = '42501';
  end if;
  select jsonb_build_object(
           'id', m.id, 'codigo', m.codigo, 'etapa', m.etapa, 'tramo', v_tramo,
           'ultimo_tramo', public.ultimo_tramo(m.id),
           'lugar', t.lugar_inicio, 'cliente', c.razon_social,
           'factura', m.factura, 'guia', m.guia, 'dex', m.dex, 'tipo_carga', m.tipo_carga,
           'destino', d.nombre || coalesce(' (' || d.ciudad || ')', ''), 'destino_pais', d.pais,
           'telefono_coordinador', m.telefono_coordinador,
           'toneladas_fabrica', (select sum(a.toneladas_cargadas) from public.asignaciones a
                                  where a.mision_id = m.id and a.tramo = 1 and a.etapa <> 'cancelado'),
           'llegan', (select coalesce(jsonb_agg(jsonb_build_object(
                        'id', a.id, 'placa', v.placa, 'chofer', co.nombre, 'telefono', co.telefono,
                        'etapa', a.etapa, 'toneladas', coalesce(a.toneladas_declaradas, a.toneladas_cargadas),
                        'precinto', a.precinto, 'ultima_senal', a.ultima_senal
                      ) order by a.creado_en), '[]'::jsonb)
                       from public.asignaciones a
                       join public.vehiculos v on v.id = a.vehiculo_id
                       join public.conductores co on co.id = a.conductor_id
                      where a.mision_id = m.id and a.tramo = v_tramo - 1 and a.etapa <> 'cancelado'),
           'mis_camiones', (select coalesce(jsonb_agg(jsonb_build_object(
                        'id', a.id, 'placa', v.placa, 'chofer', co.nombre, 'telefono', co.telefono,
                        'etapa', a.etapa, 'toneladas', a.toneladas_declaradas, 'precinto', a.precinto,
                        'ultima_senal', a.ultima_senal,
                        'invitacion', (select jsonb_build_object('codigo', i.codigo, 'vence_en', i.vence_en, 'usado_en', i.usado_en)
                                         from public.invitaciones_chofer i
                                        where i.asignacion_id = a.id and not i.revocada
                                        order by i.creado_en desc limit 1)
                      ) order by a.creado_en), '[]'::jsonb)
                       from public.asignaciones a
                       join public.vehiculos v on v.id = a.vehiculo_id
                       join public.conductores co on co.id = a.conductor_id
                      where a.mision_id = m.id and a.tramo = v_tramo and a.etapa <> 'cancelado'),
           'documentos', public.documentos_vigentes(m.id)
         )
    into resultado
    from public.misiones m
    join public.clientes c on c.id = m.cliente_id
    join public.ubicaciones d on d.id = m.destino_id
    left join public.tramos t on t.mision_id = m.id and t.numero = v_tramo
   where m.id = p_mision;
  return resultado;
end $$;

-- Choferes y camiones de la empresa del operador.
create or replace function public.operador_catalogo()
returns jsonb language plpgsql stable security definer
set search_path = public as $$
declare
  o public.operadores_transbordo := public.exigir_operador();
begin
  return jsonb_build_object(
    'conductores', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'nombre', c.nombre, 'telefono', c.telefono)
                                              order by c.nombre), '[]'::jsonb)
                      from public.conductores c where c.transportista_id = o.transportista_id and c.activo),
    'vehiculos', (select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'placa', v.placa, 'capacidad_tn', v.capacidad_tn)
                                            order by v.placa), '[]'::jsonb)
                    from public.vehiculos v where v.transportista_id = o.transportista_id)
  );
end $$;

-- Nuevo chofer de la empresa del operador (si ya existe con el mismo CI, devuelve ese).
create or replace function public.operador_guardar_conductor(
  p_nombre text, p_telefono text, p_ci text default null, p_licencia text default null
) returns uuid language plpgsql security definer
set search_path = public as $$
declare
  o public.operadores_transbordo := public.exigir_operador();
  existente uuid;
  nuevo uuid;
begin
  if coalesce(trim(p_nombre), '') = '' then
    raise exception 'Escriba el nombre del chofer.';
  end if;
  if coalesce(trim(p_telefono), '') = '' then
    raise exception 'Escriba el WhatsApp del chofer: se le envía el código de la app.';
  end if;
  if nullif(trim(coalesce(p_ci, '')), '') is not null then
    select id into existente from public.conductores
     where transportista_id = o.transportista_id and ci = trim(p_ci) limit 1;
    if existente is not null then
      update public.conductores set activo = true where id = existente and not activo;
      return existente;
    end if;
  end if;
  insert into public.conductores (transportista_id, nombre, telefono, ci, licencia)
  values (o.transportista_id, trim(p_nombre), trim(p_telefono), nullif(trim(coalesce(p_ci, '')), ''),
          nullif(trim(coalesce(p_licencia, '')), ''))
  returning id into nuevo;
  return nuevo;
end $$;

-- Nuevo camión de la empresa del operador (si la placa ya es suya, devuelve ese).
create or replace function public.operador_guardar_vehiculo(
  p_placa text, p_marca text default null, p_capacidad numeric default null
) returns uuid language plpgsql security definer
set search_path = public as $$
declare
  o public.operadores_transbordo := public.exigir_operador();
  placa_limpia text := upper(regexp_replace(coalesce(p_placa, ''), '\s+', '', 'g'));
  existente record;
  nuevo uuid;
begin
  if placa_limpia !~ '^[A-Z0-9-]{5,10}$' then
    raise exception 'La placa «%» no tiene un formato válido (ej. 1234ABC).', p_placa;
  end if;
  select id, transportista_id into existente from public.vehiculos where placa = placa_limpia;
  if existente.id is not null then
    if existente.transportista_id <> o.transportista_id then
      raise exception 'La placa % está registrada a otra empresa. Pida a despacho que la revise.', placa_limpia;
    end if;
    return existente.id;
  end if;
  insert into public.vehiculos (transportista_id, placa, marca, capacidad_tn)
  values (o.transportista_id, placa_limpia, nullif(trim(coalesce(p_marca, '')), ''), p_capacidad)
  returning id into nuevo;
  return nuevo;
end $$;

-- Agrega un camión al tramo del operador y genera el código para la app del chofer.
create or replace function public.operador_agregar_camion(
  p_mision uuid, p_conductor uuid, p_vehiculo uuid, p_toneladas numeric, p_precinto text
) returns table (asignacion_id uuid, codigo text, vence_en timestamptz)
language plpgsql security definer
set search_path = public as $$
declare
  o public.operadores_transbordo := public.exigir_operador();
  v_tramo smallint := public.operador_tramo_de(p_mision);
  etapa_mision public.etapa_envio;
  nueva uuid;
  inv record;
begin
  if v_tramo is null then
    raise exception 'Esta carga no está asignada a su empresa.' using errcode = '42501';
  end if;
  select etapa into etapa_mision from public.misiones where id = p_mision;
  if etapa_mision in ('entregado', 'cancelado') then
    raise exception 'La misión ya está cerrada.';
  end if;
  if not exists (select 1 from public.conductores where id = p_conductor and transportista_id = o.transportista_id and activo) then
    raise exception 'Elija un chofer de su empresa.';
  end if;
  if not exists (select 1 from public.vehiculos where id = p_vehiculo and transportista_id = o.transportista_id) then
    raise exception 'Elija un camión de su empresa.';
  end if;
  if p_toneladas is null or p_toneladas <= 0 then
    raise exception 'Escriba las toneladas que lleva este camión.';
  end if;
  if coalesce(trim(p_precinto), '') = '' then
    raise exception 'Escriba el número de precinto del camión.';
  end if;
  if exists (select 1 from public.asignaciones
              where mision_id = p_mision and asignaciones.tramo = v_tramo
                and vehiculo_id = p_vehiculo and etapa <> 'cancelado') then
    raise exception 'Ese camión ya está registrado en esta carga.';
  end if;

  insert into public.asignaciones (mision_id, transportista_id, conductor_id, vehiculo_id, tramo, toneladas_declaradas, precinto)
  values (p_mision, o.transportista_id, p_conductor, p_vehiculo, v_tramo, p_toneladas, trim(p_precinto))
  returning id into nueva;

  -- Aviso para despacho en los eventos de la misión.
  insert into public.eventos (asignacion_id, tipo, origen, detalle, registrado_por)
  values (nueva, 'nota', 'sistema',
          jsonb_build_object('motivo', 'camion_registrado_por_operador', 'operador', o.nombre,
                             'toneladas', p_toneladas, 'precinto', trim(p_precinto)),
          auth.uid());

  select * into inv from public.emitir_invitacion(nueva, 72);
  return query select nueva, inv.codigo, inv.vence_en;
end $$;

-- Corrige toneladas o precinto de un camión suyo que aún no salió.
create or replace function public.operador_corregir_camion(p_asignacion uuid, p_toneladas numeric, p_precinto text)
returns void language plpgsql security definer
set search_path = public as $$
declare
  o public.operadores_transbordo := public.exigir_operador();
  a record;
begin
  select id, mision_id, tramo, etapa, transportista_id into a from public.asignaciones where id = p_asignacion;
  if a.id is null or a.transportista_id <> o.transportista_id or public.operador_tramo_de(a.mision_id) is distinct from a.tramo then
    raise exception 'Este camión no es de su empresa.' using errcode = '42501';
  end if;
  if a.etapa not in ('programado', 'cargado') then
    raise exception 'El camión ya salió: pida a despacho cualquier corrección.';
  end if;
  if p_toneladas is null or p_toneladas <= 0 or coalesce(trim(p_precinto), '') = '' then
    raise exception 'Escriba las toneladas y el número de precinto.';
  end if;
  update public.asignaciones set toneladas_declaradas = p_toneladas, precinto = trim(p_precinto) where id = p_asignacion;
end $$;

-- Nuevo código para el chofer de un camión suyo (por ejemplo, cambió de teléfono).
create or replace function public.operador_nueva_invitacion(p_asignacion uuid)
returns table (codigo text, vence_en timestamptz)
language plpgsql security definer
set search_path = public as $$
declare
  o public.operadores_transbordo := public.exigir_operador();
  a record;
begin
  select id, mision_id, tramo, transportista_id into a from public.asignaciones where id = p_asignacion;
  if a.id is null or a.transportista_id <> o.transportista_id or public.operador_tramo_de(a.mision_id) is distinct from a.tramo then
    raise exception 'Este camión no es de su empresa.' using errcode = '42501';
  end if;
  return query select * from public.emitir_invitacion(p_asignacion, 72);
end $$;

-- «Recibí la carga»: el camión del tramo anterior termina con «Entregado en transbordo».
create or replace function public.operador_recibi_carga(p_asignacion uuid, p_nota text default null)
returns public.etapa_envio language plpgsql security definer
set search_path = public as $$
declare
  o public.operadores_transbordo := public.exigir_operador();
  a record;
begin
  select id, mision_id, tramo, etapa into a from public.asignaciones where id = p_asignacion;
  if a.id is null or public.operador_tramo_de(a.mision_id) is distinct from (a.tramo + 1)::smallint then
    raise exception 'Este camión no entrega la carga a su empresa.' using errcode = '42501';
  end if;
  if a.etapa = 'entregado' then
    return a.etapa;
  end if;
  if a.etapa in ('programado', 'cancelado') then
    raise exception 'Este camión todavía no inició el viaje (o fue cancelado). Consulte con despacho.';
  end if;
  return public.aplicar_etapa(p_asignacion, 'entregado', 'sistema', now(),
           jsonb_build_object('motivo', 'recibido_en_transbordo', 'operador', o.nombre,
                              'nota', nullif(trim(coalesce(p_nota, '')), '')));
end $$;

-- Registra un documento ya subido al bucket (CRT, MIC/DTA, foto u otro).
create or replace function public.operador_registrar_documento(
  p_mision uuid, p_tipo public.tipo_documento, p_ruta text, p_nombre text,
  p_asignacion uuid default null, p_numero text default null,
  p_tipo_mime text default null, p_tamano integer default null, p_reemplaza uuid default null
) returns uuid language plpgsql security definer
set search_path = public, storage as $$
declare
  o public.operadores_transbordo := public.exigir_operador();
  nuevo uuid;
begin
  if public.operador_tramo_de(p_mision) is null then
    raise exception 'Esta carga no está asignada a su empresa.' using errcode = '42501';
  end if;
  if p_tipo not in ('crt', 'mic_dta', 'otro') then
    raise exception 'Desde el transbordo se suben CRT, MIC/DTA o fotos.';
  end if;
  if p_tipo in ('crt', 'mic_dta') and coalesce(trim(p_numero), '') = '' then
    raise exception 'Escriba el número del documento.';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'documentos' and name = p_ruta) then
    raise exception 'El archivo no se subió. Intente de nuevo.';
  end if;
  if p_reemplaza is not null and not exists (
       select 1 from public.documentos where id = p_reemplaza and mision_id = p_mision and reemplazado_por is null) then
    raise exception 'El documento que quiere reemplazar no existe o ya fue reemplazado.';
  end if;
  insert into public.documentos (mision_id, asignacion_id, tipo, numero, ruta_archivo, nombre_original,
                                 subido_por, subido_por_operador, tipo_mime, tamano_bytes)
  values (p_mision, p_asignacion, p_tipo, nullif(trim(coalesce(p_numero, '')), ''), p_ruta, left(p_nombre, 200),
          null, o.id, p_tipo_mime, p_tamano)
  returning id into nuevo;
  if p_reemplaza is not null then
    update public.documentos set reemplazado_por = nuevo where id = p_reemplaza;
  end if;
  if p_asignacion is not null and p_tipo in ('crt', 'mic_dta') then
    insert into public.eventos (asignacion_id, tipo, origen, detalle, registrado_por)
    values (p_asignacion, 'nota', 'sistema',
            jsonb_build_object('motivo', 'documento_operador', 'operador', o.nombre, 'documento', p_tipo,
                               'numero', trim(p_numero)),
            auth.uid());
  end if;
  return nuevo;
end $$;

-- DESPACHO: reemplaza un documento por otro (versiones; no se borra nada).
create or replace function public.reemplazar_documento(p_anterior uuid, p_nuevo uuid)
returns void language plpgsql security definer
set search_path = public as $$
begin
  if not public.puede_editar() then
    raise exception 'No tiene permiso para modificar documentos.' using errcode = '42501';
  end if;
  update public.documentos set reemplazado_por = p_nuevo
   where id = p_anterior and reemplazado_por is null
     and mision_id = (select mision_id from public.documentos where id = p_nuevo);
end $$;

-- ---------------------------------------------------------------------------
-- Alerta: un camión del tramo 2 o 3 sale hacia Perú sin CRT o MIC/DTA.
-- ---------------------------------------------------------------------------
create or replace function public.trg_documentos_salida()
returns trigger language plpgsql security definer
set search_path = public as $$
declare
  faltan text[];
begin
  if new.tramo > 1 and old.etapa in ('programado', 'cargado')
     and new.etapa in ('en_ruta', 'en_frontera', 'cruzo_frontera')
     and exists (select 1 from public.misiones m join public.ubicaciones d on d.id = m.destino_id
                  where m.id = new.mision_id and d.pais = 'PE') then
    select array_agg(t) into faltan
      from unnest(array['crt', 'mic_dta']::public.tipo_documento[]) t
     where not exists (select 1 from public.documentos d
                        where d.mision_id = new.mision_id and d.tipo = t and d.reemplazado_por is null
                          and (d.asignacion_id = new.id or d.asignacion_id is null));
    if faltan is not null then
      insert into public.eventos (asignacion_id, tipo, origen, detalle)
      values (new.id, 'incidencia', 'sistema',
              jsonb_build_object('motivo', 'sin_documentos_transbordo', 'faltan', to_jsonb(faltan)));
    end if;
  end if;
  return new;
end $$;
create trigger asignaciones_documentos_salida
  after update of etapa on public.asignaciones
  for each row execute function public.trg_documentos_salida();

-- ---------------------------------------------------------------------------
-- Permisos de ejecución
-- ---------------------------------------------------------------------------
revoke execute on function public.operador_actual(), public.operador_tramo_de(uuid), public.mision_de_ruta(text),
  public.registrar_operador(text, text, uuid, text), public.mi_operador(), public.exigir_operador(),
  public.documentos_vigentes(uuid), public.operador_mis_cargas(), public.operador_carga(uuid), public.operador_catalogo(),
  public.operador_guardar_conductor(text, text, text, text), public.operador_guardar_vehiculo(text, text, numeric),
  public.operador_agregar_camion(uuid, uuid, uuid, numeric, text), public.operador_corregir_camion(uuid, numeric, text),
  public.operador_nueva_invitacion(uuid), public.operador_recibi_carga(uuid, text),
  public.operador_registrar_documento(uuid, public.tipo_documento, text, text, uuid, text, text, integer, uuid),
  public.reemplazar_documento(uuid, uuid)
  from public, anon;
grant execute on function public.operador_tramo_de(uuid), public.mision_de_ruta(text),
  public.registrar_operador(text, text, uuid, text), public.mi_operador(),
  public.operador_mis_cargas(), public.operador_carga(uuid), public.operador_catalogo(),
  public.operador_guardar_conductor(text, text, text, text), public.operador_guardar_vehiculo(text, text, numeric),
  public.operador_agregar_camion(uuid, uuid, uuid, numeric, text), public.operador_corregir_camion(uuid, numeric, text),
  public.operador_nueva_invitacion(uuid), public.operador_recibi_carga(uuid, text),
  public.operador_registrar_documento(uuid, public.tipo_documento, text, text, uuid, text, text, integer, uuid),
  public.reemplazar_documento(uuid, uuid)
  to authenticated;
-- Uso interno (no se llaman desde la página).
revoke execute on function public.emitir_invitacion(uuid, int), public.trg_usuario_no_operador(),
  public.trg_validar_documento(), public.trg_documentos_salida()
  from public, anon, authenticated;
