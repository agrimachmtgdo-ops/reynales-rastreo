-- =============================================================================
-- Fase C3: requerimiento de unidades (camiones) para cada envío del programa
--
--  * Cada envío confirmado se despacha como UNA misión (misiones.envio_id).
--  * Logística define cuántos camiones necesita el envío y la hora de presentación
--    en fábrica (varía por envío), y pide camiones a uno o varios transportistas:
--    una «solicitud» por transportista con camiones pedidos, la respuesta
--    (camiones confirmados o rechazo) y la tarifa del flete (por viaje o por
--    tonelada, en BOB o USD).
--  * Las placas y choferes que manda el transportista se cargan como camiones de
--    la misión (asignaciones) ligados a su solicitud. Se registra la llegada a
--    fábrica o que el camión no se presentó (queda cancelado, con su causa).
--  * El estado del envío y del pedido se actualiza solo con la misión:
--    en camino → «en curso», entregada → «cumplido». El pedido queda «cumplido»
--    cuando todos sus envíos vivos se entregaron y cubren lo pedido (-3 %).
--  * Días de anticipación para pedir camiones: parámetro (4 por defecto) que
--    cambia el administrador.
--  * La tarifa la ven solo administrador y logística; comercial y gerencia ven el
--    costo total de cada envío.
--
-- No borra ni modifica datos existentes (solo agrega columnas, una tabla, un
-- parámetro y funciones). Reversión: supabase/revertir/20261212000100_requerimiento_unidades.sql
-- =============================================================================
set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Parámetro: días de anticipación
-- ---------------------------------------------------------------------------
insert into public.configuracion (clave, valor) values ('dias_anticipacion_camiones', '4')
on conflict (clave) do nothing;

create or replace function public.dias_anticipacion_camiones()
returns integer language sql stable security definer
set search_path = public as $$
  select coalesce((select (valor #>> '{}')::int from public.configuracion where clave = 'dias_anticipacion_camiones'), 4)
$$;

create or replace function public.fijar_dias_anticipacion(p_dias integer)
returns void language plpgsql security definer
set search_path = public as $$
begin
  if not public.es_administrador() then
    raise exception 'Solo el administrador cambia los días de anticipación.' using errcode = '42501';
  end if;
  if p_dias is null or p_dias < 1 or p_dias > 30 then
    raise exception 'Los días de anticipación deben estar entre 1 y 30.';
  end if;
  insert into public.configuracion (clave, valor, actualizado_en) values ('dias_anticipacion_camiones', to_jsonb(p_dias), now())
  on conflict (clave) do update set valor = excluded.valor, actualizado_en = now();
end $$;

-- ---------------------------------------------------------------------------
-- Columnas nuevas
-- ---------------------------------------------------------------------------
alter table public.programa_envios
  add column camiones_necesarios smallint check (camiones_necesarios between 1 and 60),
  add column presentacion timestamptz,
  add column embarque_fecha date;
comment on column public.programa_envios.camiones_necesarios is 'Camiones que logística necesita para el envío (vacío = estimado por toneladas).';
comment on column public.programa_envios.presentacion is 'Hora de presentación de los camiones en fábrica para este envío.';
comment on column public.programa_envios.embarque_fecha is 'FOB: fecha de embarque en el puerto, que informa el agente de carga.';

alter table public.misiones
  add column envio_id uuid references public.programa_envios (id) on delete set null;
create unique index misiones_envio_vivo on public.misiones (envio_id) where envio_id is not null and etapa <> 'cancelado';
comment on column public.misiones.envio_id is 'Envío del programa que despacha esta misión (una misión viva por envío).';

create table public.solicitudes_camiones (
  id                   uuid primary key default gen_random_uuid(),
  envio_id             uuid not null references public.programa_envios (id) on delete cascade,
  transportista_id     uuid not null references public.transportistas (id) on delete restrict,
  camiones_pedidos     smallint not null check (camiones_pedidos between 1 and 60),
  camiones_confirmados smallint check (camiones_confirmados between 0 and 60),
  presentacion         timestamptz,
  tarifa               numeric(12, 2) check (tarifa is null or tarifa >= 0),
  tarifa_tipo          text not null default 'viaje' check (tarifa_tipo in ('viaje', 'tonelada')),
  moneda               text not null default 'BOB' check (moneda in ('BOB', 'USD')),
  estado               text not null default 'pedido' check (estado in ('pedido', 'confirmado', 'rechazado', 'anulado')),
  nota                 text check (nota is null or length(nota) <= 500),
  creado_por           uuid references public.usuarios (id) on delete set null default auth.uid(),
  creado_en            timestamptz not null default now(),
  respondido_en        timestamptz
);
create index solicitudes_camiones_envio_idx on public.solicitudes_camiones (envio_id);
create index solicitudes_camiones_transportista_idx on public.solicitudes_camiones (transportista_id, creado_en desc);
comment on table public.solicitudes_camiones is 'Pedido de camiones a un transportista para un envío. Se escribe solo con funciones.';

alter table public.solicitudes_camiones enable row level security;
-- La tarifa es reservada: solo administrador y logística leen la tabla.
create policy solicitudes_leer on public.solicitudes_camiones for select to authenticated using (public.puede_editar());
revoke all on public.solicitudes_camiones from anon;

alter table public.asignaciones
  add column solicitud_id uuid references public.solicitudes_camiones (id) on delete set null,
  add column llegada_fabrica timestamptz,
  add column ausencia_causa text check (ausencia_causa is null or length(ausencia_causa) <= 300);
create index asignaciones_solicitud_idx on public.asignaciones (solicitud_id) where solicitud_id is not null;

-- ---------------------------------------------------------------------------
-- Ayudas
-- ---------------------------------------------------------------------------
-- Camiones estimados para unas toneladas (29 t por camión con 5 % de margen).
create or replace function public.camiones_estimados(p_toneladas numeric)
returns integer language sql immutable as $$
  select greatest(1, ceil(coalesce(p_toneladas, 0) / (29 * 1.05)))::int
$$;

-- Misión viva (no cancelada) de un envío.
create or replace function public.mision_de_envio(p_envio uuid)
returns uuid language sql stable security definer
set search_path = public as $$
  select id from public.misiones where envio_id = p_envio and etapa <> 'cancelado' order by creado_en desc limit 1
$$;

-- Fecha comprometida (día) → hora límite en Bolivia (fin del día).
create or replace function public.fin_del_dia_bolivia(p_fecha date)
returns timestamptz language sql immutable as $$
  select case when p_fecha is null then null else (p_fecha + time '23:59') at time zone 'America/La_Paz' end
$$;

-- Costo de una solicitud: por viaje = tarifa × camiones confirmados; por tonelada =
-- tarifa × toneladas pesadas de sus camiones (o, si aún no cargaron, la parte del envío).
create or replace function public.costo_solicitud(p_solicitud uuid)
returns numeric language sql stable security definer
set search_path = public as $$
  select case
    when s.tarifa is null or s.estado <> 'confirmado' then null
    when s.tarifa_tipo = 'viaje' then s.tarifa * coalesce(s.camiones_confirmados, 0)
    else s.tarifa * coalesce(
      (select sum(a.toneladas_cargadas) from public.asignaciones a
        where a.solicitud_id = s.id and a.etapa <> 'cancelado' and a.toneladas_cargadas is not null),
      e.toneladas * coalesce(s.camiones_confirmados, 0)
        / greatest(coalesce(e.camiones_necesarios, public.camiones_estimados(e.toneladas)), 1))
  end
  from public.solicitudes_camiones s join public.programa_envios e on e.id = s.envio_id
  where s.id = p_solicitud
$$;

-- ---------------------------------------------------------------------------
-- Estado automático del envío y del pedido según la misión
-- ---------------------------------------------------------------------------
create or replace function public.recalcular_estado_pedido(p_pedido uuid)
returns void language plpgsql security definer
set search_path = public as $$
declare
  p public.pedidos;
  vivos int;
  cumplidos int;
  movidos int;
  nuevo text;
begin
  select * into p from public.pedidos where id = p_pedido for update;
  if p.id is null or p.estado not in ('confirmado', 'en_ejecucion', 'cumplido') then return; end if;
  select count(*) filter (where estado <> 'cancelado'),
         count(*) filter (where estado = 'cumplido'),
         count(*) filter (where estado in ('en_curso', 'cumplido'))
    into vivos, cumplidos, movidos
    from public.programa_envios where pedido_id = p_pedido;
  nuevo := case
    when vivos > 0 and cumplidos = vivos and public.toneladas_programadas(p_pedido) >= p.toneladas * 0.97 then 'cumplido'
    when movidos > 0 then 'en_ejecucion'
    else 'confirmado'
  end;
  if nuevo <> p.estado then
    update public.pedidos set estado = nuevo, actualizado_en = now() where id = p_pedido;
  end if;
end $$;

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

create or replace function public.trg_mision_envio()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.envio_id is not null then
    perform public.recalcular_estado_envio(old.envio_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.envio_id is not null
     and (tg_op = 'INSERT' or new.envio_id is distinct from old.envio_id) then
    perform public.recalcular_estado_envio(new.envio_id);
  end if;
  return null;
end $$;

create trigger misiones_estado_envio
  after insert or delete or update of etapa, envio_id on public.misiones
  for each row execute function public.trg_mision_envio();

-- Envío ↔ misión: la fecha comprometida viaja a la misión; al cancelar el envío
-- se anulan sus pedidos de camiones (y no se cancela si ya tiene camiones vivos).
create or replace function public.trg_envio_requerimiento()
returns trigger language plpgsql security definer
set search_path = public as $$
declare
  v_mision uuid := public.mision_de_envio(new.id);
begin
  if new.estado = 'cancelado' and old.estado <> 'cancelado' then
    if v_mision is not null and exists (select 1 from public.asignaciones where mision_id = v_mision and etapa <> 'cancelado') then
      raise exception 'El envío ya tiene camiones asignados en su misión: anúlelos antes de cancelar el envío.';
    end if;
    update public.solicitudes_camiones set estado = 'anulado'
     where envio_id = new.id and estado in ('pedido', 'confirmado');
  end if;
  if v_mision is not null and new.entrega_comprometida is distinct from old.entrega_comprometida then
    update public.misiones set entrega_comprometida = public.fin_del_dia_bolivia(new.entrega_comprometida) where id = v_mision;
  end if;
  return new;
end $$;

create trigger programa_envios_requerimiento
  before update of estado, entrega_comprometida on public.programa_envios
  for each row execute function public.trg_envio_requerimiento();

-- ---------------------------------------------------------------------------
-- Funciones de logística (administrador y logística)
-- ---------------------------------------------------------------------------
-- Envío confirmado y vivo, bloqueado para escribir; valida el permiso.
create or replace function public.envio_para_camiones(p_envio uuid)
returns public.programa_envios language plpgsql security definer
set search_path = public as $$
declare
  e public.programa_envios;
begin
  if not public.puede_editar() then
    raise exception 'Solo el administrador o logística piden y asignan camiones.' using errcode = '42501';
  end if;
  select * into e from public.programa_envios where id = p_envio for update;
  if e.id is null then raise exception 'No existe ese envío.'; end if;
  if e.estado = 'planificado' then
    raise exception 'El envío aún es planificado: confirme el programa antes de pedir camiones.';
  end if;
  if e.estado not in ('pendiente', 'en_curso') then
    raise exception 'El envío está cerrado (cumplido o cancelado).';
  end if;
  return e;
end $$;

-- Camiones necesarios y hora de presentación en fábrica del envío.
create or replace function public.guardar_requerimiento(p_envio uuid, p_camiones integer, p_presentacion timestamptz)
returns void language plpgsql security definer
set search_path = public as $$
declare
  e public.programa_envios := public.envio_para_camiones(p_envio);
begin
  if p_camiones is not null and (p_camiones < 1 or p_camiones > 60) then
    raise exception 'Los camiones necesarios deben estar entre 1 y 60.';
  end if;
  update public.programa_envios set camiones_necesarios = p_camiones, presentacion = p_presentacion where id = e.id;
end $$;

-- Pide camiones a un transportista. Devuelve la solicitud.
create or replace function public.pedir_camiones(
  p_envio uuid, p_transportista uuid, p_camiones integer, p_presentacion timestamptz default null,
  p_tarifa numeric default null, p_tarifa_tipo text default 'viaje', p_moneda text default 'BOB', p_nota text default null
) returns uuid language plpgsql security definer
set search_path = public as $$
declare
  e public.programa_envios := public.envio_para_camiones(p_envio);
  v_id uuid;
begin
  if not exists (select 1 from public.transportistas where id = p_transportista) then
    raise exception 'Elija el transportista.';
  end if;
  if p_camiones is null or p_camiones < 1 or p_camiones > 60 then
    raise exception 'Escriba cuántos camiones pide (entre 1 y 60).';
  end if;
  if p_tarifa is not null and p_tarifa < 0 then raise exception 'La tarifa no puede ser negativa.'; end if;
  if coalesce(p_tarifa_tipo, 'viaje') not in ('viaje', 'tonelada') then raise exception 'La tarifa es por viaje o por tonelada.'; end if;
  if coalesce(p_moneda, 'BOB') not in ('BOB', 'USD') then raise exception 'La moneda es BOB o USD.'; end if;
  if exists (select 1 from public.solicitudes_camiones
              where envio_id = e.id and transportista_id = p_transportista and estado in ('pedido', 'confirmado')) then
    raise exception 'Ese transportista ya tiene un pedido abierto para este envío: cambie su respuesta o anúlelo.';
  end if;
  insert into public.solicitudes_camiones (envio_id, transportista_id, camiones_pedidos, presentacion, tarifa, tarifa_tipo, moneda, nota)
  values (e.id, p_transportista, p_camiones, coalesce(p_presentacion, e.presentacion), p_tarifa,
          coalesce(p_tarifa_tipo, 'viaje'), coalesce(p_moneda, 'BOB'), nullif(trim(coalesce(p_nota, '')), ''))
  returning id into v_id;
  return v_id;
end $$;

-- Registra la respuesta del transportista: 0 camiones = rechazó. Puede corregir la tarifa.
create or replace function public.responder_solicitud(
  p_solicitud uuid, p_confirmados integer, p_tarifa numeric default null, p_nota text default null
) returns void language plpgsql security definer
set search_path = public as $$
declare
  s public.solicitudes_camiones;
  v_asignados int;
begin
  select * into s from public.solicitudes_camiones where id = p_solicitud for update;
  if s.id is null then raise exception 'No existe ese pedido de camiones.'; end if;
  perform public.envio_para_camiones(s.envio_id);
  if s.estado = 'anulado' then raise exception 'El pedido de camiones está anulado.'; end if;
  if p_confirmados is null or p_confirmados < 0 or p_confirmados > s.camiones_pedidos then
    raise exception 'Los camiones confirmados deben estar entre 0 y los % pedidos.', s.camiones_pedidos;
  end if;
  select count(*) into v_asignados from public.asignaciones where solicitud_id = s.id and etapa <> 'cancelado';
  if p_confirmados < v_asignados then
    raise exception 'Ya hay % camiones de este transportista asignados: anule alguno antes de bajar la confirmación.', v_asignados;
  end if;
  if p_tarifa is not null and p_tarifa < 0 then raise exception 'La tarifa no puede ser negativa.'; end if;
  update public.solicitudes_camiones
     set camiones_confirmados = p_confirmados,
         estado = case when p_confirmados = 0 then 'rechazado' else 'confirmado' end,
         tarifa = coalesce(p_tarifa, tarifa),
         nota = coalesce(nullif(trim(coalesce(p_nota, '')), ''), nota),
         respondido_en = now()
   where id = s.id;
end $$;

-- Anula un pedido de camiones (sin camiones vivos asignados).
create or replace function public.anular_solicitud(p_solicitud uuid)
returns void language plpgsql security definer
set search_path = public as $$
declare
  s public.solicitudes_camiones;
begin
  select * into s from public.solicitudes_camiones where id = p_solicitud for update;
  if s.id is null then raise exception 'No existe ese pedido de camiones.'; end if;
  perform public.envio_para_camiones(s.envio_id);
  if exists (select 1 from public.asignaciones where solicitud_id = s.id and etapa <> 'cancelado') then
    raise exception 'Tiene camiones asignados: anúlelos (o márquelos como no presentados) antes.';
  end if;
  update public.solicitudes_camiones set estado = 'anulado' where id = s.id;
end $$;

-- Crea la misión del envío (una viva por envío). Devuelve la misión.
create or replace function public.crear_mision_envio(p_envio uuid, p_origen uuid default null)
returns uuid language plpgsql security definer
set search_path = public as $$
declare
  e public.programa_envios := public.envio_para_camiones(p_envio);
  p public.pedidos;
  v_origen uuid := p_origen;
  v_id uuid;
begin
  v_id := public.mision_de_envio(e.id);
  if v_id is not null then return v_id; end if;
  if v_origen is null then
    if (select count(*) from public.ubicaciones where tipo = 'fabrica') <> 1 then
      raise exception 'Elija la fábrica de origen.';
    end if;
    select id into v_origen from public.ubicaciones where tipo = 'fabrica';
  elsif not exists (select 1 from public.ubicaciones where id = v_origen and tipo = 'fabrica') then
    raise exception 'El origen debe ser una fábrica.';
  end if;
  select * into p from public.pedidos where id = e.pedido_id;
  insert into public.misiones (cliente_id, origen_id, destino_id, tipo_carga, tonelaje_objetivo, entrega_comprometida, envio_id, notas)
  values (p.cliente_id, v_origen, p.destino_id, p.producto, e.toneladas,
          public.fin_del_dia_bolivia(coalesce(e.entrega_comprometida, e.entrega_vigente)), e.id,
          format('Pedido %s%s · envío %s · %s', p.codigo,
                 coalesce(' (OC ' || p.orden_compra || ')', ''), e.numero, p.incoterm))
  returning id into v_id;
  return v_id;
end $$;

-- Carga un camión (placa y chofer) que mandó el transportista de la solicitud.
create or replace function public.agregar_camion_solicitud(p_solicitud uuid, p_conductor uuid, p_vehiculo uuid)
returns uuid language plpgsql security definer
set search_path = public as $$
declare
  s public.solicitudes_camiones;
  v_mision uuid;
  v_id uuid;
begin
  select * into s from public.solicitudes_camiones where id = p_solicitud for update;
  if s.id is null then raise exception 'No existe ese pedido de camiones.'; end if;
  perform public.envio_para_camiones(s.envio_id);
  if s.estado <> 'confirmado' then
    raise exception 'Primero registre cuántos camiones confirmó el transportista.';
  end if;
  if (select count(*) from public.asignaciones where solicitud_id = s.id and etapa <> 'cancelado') >= s.camiones_confirmados then
    raise exception 'Ya están cargados los % camiones que confirmó este transportista.', s.camiones_confirmados;
  end if;
  if not exists (select 1 from public.conductores where id = p_conductor and transportista_id = s.transportista_id) then
    raise exception 'El chofer no pertenece a ese transportista (regístrelo en Catálogos).';
  end if;
  if not exists (select 1 from public.vehiculos where id = p_vehiculo and transportista_id = s.transportista_id) then
    raise exception 'El camión no pertenece a ese transportista (regístrelo en Catálogos).';
  end if;
  v_mision := public.mision_de_envio(s.envio_id);
  if v_mision is null then raise exception 'Primero cree la misión del envío.'; end if;
  if exists (select 1 from public.asignaciones
              where mision_id = v_mision and etapa <> 'cancelado' and (vehiculo_id = p_vehiculo or conductor_id = p_conductor)) then
    raise exception 'Ese chofer o ese camión ya está en este envío.';
  end if;
  insert into public.asignaciones (mision_id, transportista_id, conductor_id, vehiculo_id, tramo, solicitud_id)
  values (v_mision, s.transportista_id, p_conductor, p_vehiculo, 1, s.id)
  returning id into v_id;
  return v_id;
end $$;

-- Llegada del camión a fábrica (antes de cargar).
create or replace function public.registrar_llegada(p_asignacion uuid, p_momento timestamptz default now())
returns void language plpgsql security definer
set search_path = public as $$
declare
  a public.asignaciones;
begin
  if not public.puede_editar() then
    raise exception 'Solo el administrador o logística registran llegadas.' using errcode = '42501';
  end if;
  select * into a from public.asignaciones where id = p_asignacion for update;
  if a.id is null then raise exception 'No existe ese camión.'; end if;
  if a.etapa = 'cancelado' then raise exception 'El camión está anulado.'; end if;
  if a.tramo <> 1 then raise exception 'La llegada a fábrica es solo para camiones del primer tramo.'; end if;
  update public.asignaciones set llegada_fabrica = least(coalesce(p_momento, now()), now()) where id = a.id;
end $$;

-- El camión no se presentó: queda anulado con la causa (cuenta para el cumplimiento del transportista).
create or replace function public.registrar_ausencia(p_asignacion uuid, p_causa text)
returns void language plpgsql security definer
set search_path = public as $$
declare
  a public.asignaciones;
begin
  if not public.puede_editar() then
    raise exception 'Solo el administrador o logística registran ausencias.' using errcode = '42501';
  end if;
  select * into a from public.asignaciones where id = p_asignacion for update;
  if a.id is null then raise exception 'No existe ese camión.'; end if;
  if a.etapa <> 'programado' or a.llegada_fabrica is not null then
    raise exception 'Solo se marca «no se presentó» a un camión programado que no llegó a fábrica.';
  end if;
  if coalesce(trim(p_causa), '') = '' then raise exception 'Escriba la causa (por ejemplo: no avisó, avería, otro viaje).'; end if;
  update public.asignaciones set ausencia_causa = trim(p_causa) where id = a.id;
  perform public.aplicar_etapa(a.id, 'cancelado', 'despacho', now(),
                               jsonb_build_object('motivo', 'no_se_presento', 'causa', trim(p_causa)));
end $$;

-- FOB: fecha de embarque que informa el agente de carga.
create or replace function public.registrar_embarque(p_envio uuid, p_fecha date)
returns void language plpgsql security definer
set search_path = public as $$
declare
  e public.programa_envios;
begin
  if not public.puede_editar() then
    raise exception 'Solo el administrador o logística registran el embarque.' using errcode = '42501';
  end if;
  select * into e from public.programa_envios where id = p_envio for update;
  if e.id is null then raise exception 'No existe ese envío.'; end if;
  if (select incoterm from public.pedidos where id = e.pedido_id) <> 'FOB' then
    raise exception 'La fecha de embarque se registra solo en envíos FOB.';
  end if;
  update public.programa_envios set embarque_fecha = p_fecha where id = e.id;
end $$;

-- ---------------------------------------------------------------------------
-- Resumen del programa para el panel (todo el personal; sin tarifas, con costo)
-- ---------------------------------------------------------------------------
create or replace function public.resumen_programa(p_desde date, p_hasta date, p_envio uuid default null)
returns table (
  envio_id uuid, numero smallint, estado text, toneladas numeric,
  fecha_carga date, entrega_vigente date, entrega_comprometida date, presentacion timestamptz, embarque_fecha date,
  pedido_id uuid, pedido_codigo text, orden_compra text, producto text, incoterm text,
  cliente text, destino text, destino_pais text,
  camiones_necesarios integer, camiones_pedidos integer, camiones_confirmados integer,
  camiones_asignados integer, camiones_en_fabrica integer, camiones_ausentes integer,
  mision_id uuid, mision_codigo text, mision_etapa text, costo jsonb
) language plpgsql stable security definer
set search_path = public as $$
#variable_conflict use_column
begin
  if not public.es_personal() then
    raise exception 'Sin permiso.' using errcode = '42501';
  end if;
  return query
  select e.id, e.numero, e.estado, e.toneladas,
         e.fecha_carga_planificada, e.entrega_vigente, e.entrega_comprometida, e.presentacion, e.embarque_fecha,
         p.id, p.codigo, p.orden_compra, p.producto, p.incoterm,
         c.razon_social, u.nombre, u.pais::text,
         coalesce(e.camiones_necesarios, public.camiones_estimados(e.toneladas)),
         coalesce(s.pedidos, 0), coalesce(s.confirmados, 0),
         coalesce(a.asignados, 0), coalesce(a.en_fabrica, 0), coalesce(a.ausentes, 0),
         m.id, m.codigo, m.etapa::text, s.costo
    from public.programa_envios e
    join public.pedidos p on p.id = e.pedido_id
    join public.clientes c on c.id = p.cliente_id
    join public.ubicaciones u on u.id = p.destino_id
    left join public.misiones m on m.id = public.mision_de_envio(e.id)
    left join lateral (
      select sum(sc.camiones_pedidos) filter (where sc.estado in ('pedido', 'confirmado'))::int as pedidos,
             sum(sc.camiones_confirmados) filter (where sc.estado = 'confirmado')::int as confirmados,
             (select jsonb_object_agg(moneda, total) from (
                select sc2.moneda, round(sum(public.costo_solicitud(sc2.id)), 2) as total
                  from public.solicitudes_camiones sc2
                 where sc2.envio_id = e.id and sc2.estado = 'confirmado' and sc2.tarifa is not null
                 group by sc2.moneda) t) as costo
        from public.solicitudes_camiones sc where sc.envio_id = e.id
    ) s on true
    left join lateral (
      select count(*) filter (where x.etapa <> 'cancelado')::int as asignados,
             count(*) filter (where x.etapa <> 'cancelado' and (x.llegada_fabrica is not null or x.etapa <> 'programado'))::int as en_fabrica,
             count(*) filter (where x.ausencia_causa is not null)::int as ausentes
        from public.asignaciones x where x.mision_id = m.id and x.tramo = 1
    ) a on true
   where (p_envio is not null and e.id = p_envio)
      or (p_envio is null and e.estado in ('pendiente', 'en_curso', 'cumplido')
          and coalesce(e.fecha_carga_planificada, e.entrega_vigente) between p_desde and p_hasta)
   order by coalesce(e.fecha_carga_planificada, e.entrega_vigente), p.codigo, e.numero;
end $$;

-- ---------------------------------------------------------------------------
-- Permisos de ejecución
-- ---------------------------------------------------------------------------
revoke execute on function
  public.dias_anticipacion_camiones(), public.fijar_dias_anticipacion(integer),
  public.camiones_estimados(numeric), public.mision_de_envio(uuid), public.fin_del_dia_bolivia(date),
  public.costo_solicitud(uuid), public.recalcular_estado_pedido(uuid), public.recalcular_estado_envio(uuid),
  public.trg_mision_envio(), public.trg_envio_requerimiento(), public.envio_para_camiones(uuid),
  public.guardar_requerimiento(uuid, integer, timestamptz),
  public.pedir_camiones(uuid, uuid, integer, timestamptz, numeric, text, text, text),
  public.responder_solicitud(uuid, integer, numeric, text), public.anular_solicitud(uuid),
  public.crear_mision_envio(uuid, uuid), public.agregar_camion_solicitud(uuid, uuid, uuid),
  public.registrar_llegada(uuid, timestamptz), public.registrar_ausencia(uuid, text),
  public.registrar_embarque(uuid, date), public.resumen_programa(date, date, uuid)
  from public, anon;
grant execute on function
  public.dias_anticipacion_camiones(), public.fijar_dias_anticipacion(integer), public.camiones_estimados(numeric),
  public.guardar_requerimiento(uuid, integer, timestamptz),
  public.pedir_camiones(uuid, uuid, integer, timestamptz, numeric, text, text, text),
  public.responder_solicitud(uuid, integer, numeric, text), public.anular_solicitud(uuid),
  public.crear_mision_envio(uuid, uuid), public.agregar_camion_solicitud(uuid, uuid, uuid),
  public.registrar_llegada(uuid, timestamptz), public.registrar_ausencia(uuid, text),
  public.registrar_embarque(uuid, date), public.resumen_programa(date, date, uuid)
  to authenticated;
