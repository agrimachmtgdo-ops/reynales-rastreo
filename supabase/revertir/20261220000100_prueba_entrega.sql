-- Reversión de 20261220000100_prueba_entrega.sql: quita la prueba de entrega y vuelve
-- «Completo» (cumplimiento) al peso de fábrica. Se detiene si ya hay pruebas de entrega
-- registradas: no se borran datos. Las guías firmadas subidas quedan en Documentos.
set search_path = public, extensions;

do $$
begin
  if exists (select 1 from public.pruebas_entrega) then
    raise exception 'Hay pruebas de entrega registradas. No se puede revertir sin perderlas.';
  end if;
end $$;

-- Cumplimiento: se deshacen los 4 fragmentos (en orden inverso).
do $$
declare
  def text := pg_get_functiondef('public.reporte_cumplimiento(date, date, uuid, text)'::regprocedure);
  cambios text[][] := array[
    array['''toneladas_reales'', r.toneladas_real, ''recibido_confirmado'', r.recibido_confirmado,',
          '''toneladas_reales'', r.toneladas_real,'],
    array['case when en.hito = ''entrega'' and r.toneladas_recibidas is not null then r.toneladas_recibidas else r.toneladas_real end as toneladas_real, (en.hito = ''entrega'' and r.toneladas_recibidas is not null) as recibido_confirmado, coalesce(r.camiones, 0) as camiones,',
          'r.toneladas_real, coalesce(r.camiones, 0) as camiones,'],
    array['sum(ca.toneladas_cargadas) filter (where ca.tramo = 1) as toneladas_real, case when count(*) filter (where ca.tramo = mi.ultimo_tramo) > 0 and count(*) filter (where ca.tramo = mi.ultimo_tramo and ca.kg_recibidos is null) = 0 then round(sum(ca.kg_recibidos) filter (where ca.tramo = mi.ultimo_tramo) / 1000.0, 2) end as toneladas_recibidas,',
          'sum(ca.toneladas_cargadas) filter (where ca.tramo = 1) as toneladas_real,'],
    array['select a.mision_id, a.id, a.tramo, a.toneladas_cargadas, (select pe.kg_recibidos from public.pruebas_entrega pe where pe.asignacion_id = a.id) as kg_recibidos,',
          'select a.mision_id, a.id, a.tramo, a.toneladas_cargadas,']
  ];
  i int;
begin
  for i in 1 .. array_length(cambios, 1) loop
    if (length(def) - length(replace(def, cambios[i][1], ''))) / length(cambios[i][1]) <> 1 then
      raise exception 'No se encontró el fragmento % de reporte_cumplimiento', i;
    end if;
    def := replace(def, cambios[i][1], cambios[i][2]);
  end loop;
  execute def;
end $$;

drop function public.mermas_entrega(date, date);
drop function public.registrar_entrega_despacho(uuid, jsonb);
drop function public.foto_entrega_subida(uuid, text);
drop policy documentos_archivo_subir_chofer on storage.objects;
drop function public.chofer_puede_subir_entrega(uuid);
drop function public.registrar_entrega_chofer(uuid, jsonb, timestamptz);
drop function public.datos_entrega(uuid, jsonb, boolean);
drop table public.pruebas_entrega;
drop function public.trg_prueba_entrega_evento();
drop function public.carga_para_entrega(uuid);
drop function public.carga_esperada(uuid);
drop function public.es_ultimo_tramo(uuid);
delete from public.configuracion where clave = 'entrega_tolerancia_pct';
