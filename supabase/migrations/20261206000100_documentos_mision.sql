-- =============================================================================
-- Documentos al crear la misión (Parte A del plan aprobado el 2026-11-28)
--
--  * documentos.etiqueta: «Lista de empaque» se guarda como tipo «otro» con
--    etiqueta 'lista_empaque' (agregar un valor al enum no se puede revertir).
--  * La factura y el certificado de origen NUNCA los ve el operador de
--    transbordo: ni en su pantalla ni en el almacenamiento.
--  * Registro de quién abrió cada documento (descargas_documentos: usuario y
--    operador). Se abre siempre por public.abrir_documento().
--  * Un solo ingreso: el número de la factura, guía o DEX completa el campo de
--    la misión si estaba vacío.
--  * Alerta (sin bloquear) si el primer camión sale de fábrica sin factura, o
--    sin DEX cuando va a Perú.
--
-- No borra ni modifica datos existentes. Reversión:
-- supabase/revertir/20261206000100_documentos_mision.sql
-- =============================================================================
set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Columnas nuevas
-- ---------------------------------------------------------------------------
alter table public.documentos
  add column etiqueta text
    constraint documentos_etiqueta_valida check (etiqueta is null or (etiqueta = 'lista_empaque' and tipo = 'otro'));

alter table public.descargas_documentos
  add column usuario_id uuid references auth.users (id) on delete set null,
  add column operador_id uuid references public.operadores_transbordo (id) on delete set null;
create index descargas_documento_idx on public.descargas_documentos (documento_id, descargado_en desc);

-- ---------------------------------------------------------------------------
-- Qué documentos no ve el operador de transbordo (precios y origen comercial).
-- ---------------------------------------------------------------------------
create or replace function public.documento_oculto_operador(p_tipo public.tipo_documento)
returns boolean language sql immutable
set search_path = public as $$
  select p_tipo in ('factura', 'certificado_origen')
$$;

-- ¿El archivo está registrado como un documento que el operador puede ver?
create or replace function public.archivo_visible_operador(p_ruta text)
returns boolean language sql stable security definer
set search_path = public as $$
  select exists (select 1 from public.documentos d
                  where d.ruta_archivo = p_ruta and not public.documento_oculto_operador(d.tipo))
$$;

-- Lectura de archivos: el personal todo; el operador, lo que subió él mismo
-- (antes de registrarlo) y los documentos visibles de sus cargas.
drop policy if exists documentos_archivo_leer on storage.objects;
create policy documentos_archivo_leer on storage.objects for select to authenticated
  using (bucket_id = 'documentos'
         and (public.es_personal()
              or (public.operador_tramo_de(public.mision_de_ruta(name)) is not null
                  and (owner_id = auth.uid()::text or public.archivo_visible_operador(name)))));

-- Documentos vigentes que ve el operador (sin factura ni certificado de origen).
create or replace function public.documentos_vigentes(p_mision uuid)
returns jsonb language sql stable security definer
set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'tipo', d.tipo, 'etiqueta', d.etiqueta, 'numero', d.numero, 'nombre', d.nombre_original,
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
     and not public.documento_oculto_operador(d.tipo)
$$;

-- ---------------------------------------------------------------------------
-- Abrir un documento: valida el permiso y deja constancia de quién lo abrió.
-- ---------------------------------------------------------------------------
create or replace function public.abrir_documento(p_documento uuid)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare
  d public.documentos;
  o public.operadores_transbordo;
begin
  select * into d from public.documentos where id = p_documento;
  if d.id is null then
    raise exception 'El documento no existe.' using errcode = 'P0002';
  end if;
  if not public.es_personal() then
    select * into o from public.operador_actual();
    if o.id is null or public.operador_tramo_de(d.mision_id) is null or public.documento_oculto_operador(d.tipo) then
      raise exception 'No tiene permiso para ver este documento.' using errcode = '42501';
    end if;
  end if;
  insert into public.descargas_documentos (documento_id, usuario_id, operador_id)
  values (d.id, auth.uid(), o.id);
  return jsonb_build_object('ruta', d.ruta_archivo, 'tipo_mime', d.tipo_mime, 'nombre', d.nombre_original);
end $$;

-- ---------------------------------------------------------------------------
-- Un solo ingreso: el número del documento completa el campo vacío de la misión.
-- ---------------------------------------------------------------------------
create or replace function public.trg_documento_completa_mision()
returns trigger language plpgsql security definer
set search_path = public as $$
declare
  n text := nullif(trim(coalesce(new.numero, '')), '');
begin
  if n is null or new.reemplazado_por is not null then
    return new;
  end if;
  if new.tipo = 'factura' then
    update public.misiones set factura = n where id = new.mision_id and coalesce(trim(factura), '') = '';
  elsif new.tipo = 'dex' then
    update public.misiones set dex = n where id = new.mision_id and coalesce(trim(dex), '') = '';
  elsif new.tipo = 'guia' then
    update public.misiones set guia = n where id = new.mision_id and coalesce(trim(guia), '') = '';
  end if;
  return new;
end $$;
create trigger documentos_completa_mision
  after insert on public.documentos
  for each row execute function public.trg_documento_completa_mision();

-- ---------------------------------------------------------------------------
-- Alerta: el primer camión sale de fábrica sin factura (o sin DEX si va a Perú).
-- Una sola alerta por misión; no bloquea el viaje.
-- ---------------------------------------------------------------------------
create or replace function public.trg_documentos_carga()
returns trigger language plpgsql security definer
set search_path = public as $$
declare
  requeridos public.tipo_documento[] := array['factura']::public.tipo_documento[];
  faltan text[];
begin
  if coalesce(new.tramo, 1) <> 1 or old.etapa <> 'programado'
     or new.etapa not in ('cargado', 'en_ruta', 'en_frontera', 'cruzo_frontera') then
    return new;
  end if;
  if exists (select 1 from public.eventos e join public.asignaciones a on a.id = e.asignacion_id
              where a.mision_id = new.mision_id and e.tipo = 'incidencia'
                and e.detalle ->> 'motivo' = 'sin_documentos_carga') then
    return new;
  end if;
  if exists (select 1 from public.misiones m join public.ubicaciones u on u.id = m.destino_id
              where m.id = new.mision_id and u.pais = 'PE') then
    requeridos := requeridos || 'dex'::public.tipo_documento;
  end if;
  select array_agg(t) into faltan
    from unnest(requeridos) t
   where not exists (select 1 from public.documentos d
                      where d.mision_id = new.mision_id and d.tipo = t and d.reemplazado_por is null);
  if faltan is not null then
    insert into public.eventos (asignacion_id, tipo, origen, detalle)
    values (new.id, 'incidencia', 'sistema',
            jsonb_build_object('motivo', 'sin_documentos_carga', 'faltan', to_jsonb(faltan)));
  end if;
  return new;
end $$;
create trigger asignaciones_documentos_carga
  after update of etapa on public.asignaciones
  for each row execute function public.trg_documentos_carga();

-- ---------------------------------------------------------------------------
-- Permisos de ejecución
-- ---------------------------------------------------------------------------
revoke execute on function public.abrir_documento(uuid), public.archivo_visible_operador(text),
  public.trg_documento_completa_mision(), public.trg_documentos_carga()
  from public, anon;
grant execute on function public.abrir_documento(uuid), public.archivo_visible_operador(text) to authenticated;
revoke execute on function public.trg_documento_completa_mision(), public.trg_documentos_carga() from authenticated;
