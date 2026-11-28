-- =============================================================================
-- Reversión de 20261205000100_operador_transbordo.sql
-- Quita las cuentas de operador, sus funciones, el precinto y los datos nuevos de
-- los documentos (camión, número, versiones). ATENCIÓN: se pierden esos datos si
-- ya se cargaron. Los archivos del bucket "documentos" y sus filas en
-- public.documentos se conservan (no se borra ningún archivo).
-- =============================================================================
begin;
set search_path = public, extensions;

drop trigger if exists asignaciones_documentos_salida on public.asignaciones;
drop trigger if exists documentos_validar on public.documentos;
drop trigger if exists usuarios_no_operador on public.usuarios;

drop policy if exists documentos_archivo_leer on storage.objects;
drop policy if exists documentos_archivo_subir on storage.objects;

drop function if exists public.operador_registrar_documento(uuid, public.tipo_documento, text, text, uuid, text, text, integer, uuid);
drop function if exists public.reemplazar_documento(uuid, uuid);
drop function if exists public.operador_recibi_carga(uuid, text);
drop function if exists public.operador_nueva_invitacion(uuid);
drop function if exists public.operador_corregir_camion(uuid, numeric, text);
drop function if exists public.operador_agregar_camion(uuid, uuid, uuid, numeric, text);
drop function if exists public.operador_guardar_vehiculo(text, text, numeric);
drop function if exists public.operador_guardar_conductor(text, text, text, text);
drop function if exists public.operador_catalogo();
drop function if exists public.operador_carga(uuid);
drop function if exists public.operador_mis_cargas();
drop function if exists public.documentos_vigentes(uuid);
drop function if exists public.exigir_operador();
drop function if exists public.emitir_invitacion(uuid, int);
drop function if exists public.trg_documentos_salida();
drop function if exists public.trg_validar_documento();
drop function if exists public.mi_operador();
drop function if exists public.registrar_operador(text, text, uuid, text);
drop function if exists public.trg_usuario_no_operador();
drop function if exists public.operador_tramo_de(uuid);
drop function if exists public.operador_actual();
drop function if exists public.mision_de_ruta(text);

drop index if exists public.documentos_mision_idx;
drop index if exists public.documentos_asignacion_idx;
alter table public.documentos
  drop column if exists reemplazado_por,
  drop column if exists subido_por_operador,
  drop column if exists asignacion_id,
  drop column if exists numero,
  drop column if exists tipo_mime,
  drop column if exists tamano_bytes;
alter table public.asignaciones drop column if exists precinto;
drop table if exists public.operadores_transbordo;
-- El bucket "documentos" queda (vacío o con archivos): sin políticas, solo el administrador lo ve.
commit;
