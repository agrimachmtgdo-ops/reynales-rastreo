-- =============================================================================
-- Reversión de la fase C3 (requerimiento de unidades).
-- Quita la tabla de pedidos de camiones, las columnas nuevas, el parámetro y las
-- funciones. Las misiones y sus camiones se conservan (solo pierden el enlace al
-- envío, la solicitud, la llegada a fábrica y la causa de ausencia). Los estados
-- de envíos y pedidos que ya cambiaron (en curso, cumplido) se conservan.
-- =============================================================================
set search_path = public, extensions;

drop trigger if exists programa_envios_requerimiento on public.programa_envios;
drop trigger if exists misiones_estado_envio on public.misiones;

drop function if exists public.resumen_programa(date, date, uuid);
drop function if exists public.registrar_embarque(uuid, date);
drop function if exists public.registrar_ausencia(uuid, text);
drop function if exists public.registrar_llegada(uuid, timestamptz);
drop function if exists public.agregar_camion_solicitud(uuid, uuid, uuid);
drop function if exists public.crear_mision_envio(uuid, uuid);
drop function if exists public.anular_solicitud(uuid);
drop function if exists public.responder_solicitud(uuid, integer, numeric, text);
drop function if exists public.pedir_camiones(uuid, uuid, integer, timestamptz, numeric, text, text, text);
drop function if exists public.guardar_requerimiento(uuid, integer, timestamptz);
drop function if exists public.envio_para_camiones(uuid);
drop function if exists public.trg_envio_requerimiento();
drop function if exists public.trg_mision_envio();
drop function if exists public.recalcular_estado_envio(uuid);
drop function if exists public.recalcular_estado_pedido(uuid);
drop function if exists public.costo_solicitud(uuid);
drop function if exists public.fin_del_dia_bolivia(date);
drop function if exists public.mision_de_envio(uuid);
drop function if exists public.camiones_estimados(numeric);
drop function if exists public.fijar_dias_anticipacion(integer);
drop function if exists public.dias_anticipacion_camiones();

drop index if exists public.asignaciones_solicitud_idx;
alter table public.asignaciones
  drop column if exists ausencia_causa,
  drop column if exists llegada_fabrica,
  drop column if exists solicitud_id;

drop table if exists public.solicitudes_camiones;

drop index if exists public.misiones_envio_vivo;
alter table public.misiones drop column if exists envio_id;

alter table public.programa_envios
  drop column if exists embarque_fecha,
  drop column if exists presentacion,
  drop column if exists camiones_necesarios;

delete from public.configuracion where clave = 'dias_anticipacion_camiones';
