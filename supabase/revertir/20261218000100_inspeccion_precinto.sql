-- Reversión de 20261218000100_inspeccion_precinto.sql: quita el perfil almacén, la inspección
-- del camión, el cierre de carga y los bloqueos. Las inspecciones registradas se pierden;
-- el precinto escrito en cada camión se conserva.
-- Se detiene si hay usuarios con perfil almacén: cámbielos de perfil antes de revertir.
set search_path = public, extensions;

do $$
begin
  if exists (select 1 from public.usuarios where area = 'almacen') then
    raise exception 'Hay usuarios con perfil almacén. Cámbielos a otro perfil antes de revertir.';
  end if;
end $$;

drop function if exists public.rechazos_inspeccion(date, date);
drop function if exists public.fijar_inspeccion_obligatoria(boolean);
drop trigger if exists asignaciones_alerta_sin_inspeccion on public.asignaciones;
drop function if exists public.trg_alerta_salida_sin_inspeccion();
drop trigger if exists asignaciones_salida_carga_cerrada on public.asignaciones;
drop function if exists public.trg_salida_requiere_carga_cerrada();
drop trigger if exists asignaciones_balanza_inspeccion on public.asignaciones;
drop function if exists public.trg_balanza_requiere_inspeccion();
drop trigger if exists cargas_lote_inspeccion on public.cargas_lote;
drop function if exists public.trg_lote_requiere_inspeccion();
drop function if exists public.liberar_camion(uuid, text);
drop function if exists public.cerrar_carga(uuid, text);
drop function if exists public.registrar_inspeccion(uuid, jsonb, text, text, text, text[]);
drop function if exists public.inspeccion_obligatoria();
drop function if exists public.inspeccion_aprobada(uuid);
drop function if exists public.puntos_inspeccion();
drop table if exists public.inspecciones_camion;
alter table public.asignaciones
  drop column if exists liberado_motivo,
  drop column if exists liberado_en,
  drop column if exists liberado_por,
  drop column if exists fin_carga,
  drop column if exists inicio_carga;

drop policy if exists documentos_archivo_subir_almacen on storage.objects;

-- Lotes y balanza vuelven a exigir administrador o logística.
do $$
declare
  f text;
  def text;
begin
  foreach f in array array['public.guardar_lote(uuid, uuid, jsonb)', 'public.quitar_lote(uuid)',
                           'public.registrar_balanza(uuid, text, numeric, numeric, numeric)'] loop
    if to_regprocedure(f) is not null then
      def := pg_get_functiondef(f::regprocedure);
      execute replace(replace(def, 'if not public.puede_cargar() then', 'if not public.puede_editar() then'),
                      'Solo almacén, logística o el administrador', 'Solo el administrador o logística');
    end if;
  end loop;
end $$;
drop function if exists public.puede_cargar();
drop function if exists public.es_almacen();

create or replace function public.perfil_de(p_rol public.rol_personal, p_area text)
returns text language sql immutable
set search_path = public as $$
  select case when p_area = 'comercial' then 'comercial'
              when p_rol = 'despacho' then 'logistica'
              else p_rol::text end
$$;

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
  if v_area is distinct from 'comercial' or not p_activo then
    update public.clientes set comercial_id = null where comercial_id = p_usuario;
  end if;
end $$;

alter table public.usuarios drop constraint usuarios_area_check;
alter table public.usuarios add constraint usuarios_area_check check (area is null or area = 'comercial');
comment on column public.usuarios.area is
  'Área de trabajo. ''comercial'' = rol gerencia (solo lectura) + edición de clientes y pedidos.';

delete from public.configuracion where clave = 'inspeccion_obligatoria';
