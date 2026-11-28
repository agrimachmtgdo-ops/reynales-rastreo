-- =============================================================================
-- Reversión de 20261206000100_documentos_mision.sql
-- Vuelve a la versión del 2026-12-05: el operador vuelve a ver todos los
-- documentos de sus cargas. Se pierde la etiqueta «Lista de empaque» (esos
-- documentos quedan como «Foto u otro») y el registro de quién abrió cada
-- documento. No se borra ningún documento ni archivo.
-- =============================================================================
begin;
set search_path = public, extensions;

drop trigger if exists asignaciones_documentos_carga on public.asignaciones;
drop trigger if exists documentos_completa_mision on public.documentos;
drop function if exists public.trg_documentos_carga();
drop function if exists public.trg_documento_completa_mision();
drop function if exists public.abrir_documento(uuid);

-- Política de lectura original.
drop policy if exists documentos_archivo_leer on storage.objects;
create policy documentos_archivo_leer on storage.objects for select to authenticated
  using (bucket_id = 'documentos'
         and (public.es_personal() or public.operador_tramo_de(public.mision_de_ruta(name)) is not null));
drop function if exists public.archivo_visible_operador(text);

-- documentos_vigentes original (sin etiqueta ni filtro).
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
revoke execute on function public.documentos_vigentes(uuid) from public, anon;
drop function if exists public.documento_oculto_operador(public.tipo_documento);

drop index if exists public.descargas_documento_idx;
alter table public.descargas_documentos
  drop column if exists usuario_id,
  drop column if exists operador_id;
alter table public.documentos drop column if exists etiqueta;
commit;
