-- =============================================================================
-- 7. Tiempo real para el panel y primera versión de la política de rastreo
-- =============================================================================

-- El panel escucha cambios en asignaciones (posición y etapa) y misiones.
-- RLS se respeta: solo el personal recibe los cambios.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.asignaciones, public.misiones;
  end if;
end $$;

-- BORRADOR: revisar con un abogado antes del piloto (ver plan, sección Seguridad).
insert into public.politicas_rastreo (version, texto, vigente) values (
  '2026-11-v1',
  E'Política de rastreo de Industrias Reynales (BORRADOR)\n\n'
  '1. Finalidad: conocer la ubicación del camión y la carga despachada desde nuestra fábrica, informar al cliente y atender emergencias.\n'
  '2. Horario: la app registra su ubicación SOLO desde que usted toca "Iniciar viaje" hasta que toca "Entregado". Fuera del viaje no registra nada.\n'
  '3. Datos: ubicación, velocidad, precisión del GPS y hora. No se leen sus contactos, fotos, mensajes ni llamadas.\n'
  '4. Quién lo ve: el personal de despacho de Industrias Reynales. El cliente ve la posición del camión con retraso, nunca su nombre, CI ni teléfono.\n'
  '5. Plazo: las posiciones detalladas se guardan entre 6 y 12 meses; luego solo se conservan resúmenes del viaje.\n'
  '6. Datos móviles: la app envía la información por lotes para gastar menos de 3 MB por día.\n'
  '7. Consultas y reclamos: comuníquese con el coordinador de despacho indicado en la app.',
  true
);
