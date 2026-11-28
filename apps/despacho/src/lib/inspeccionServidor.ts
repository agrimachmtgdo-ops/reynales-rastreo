import 'server-only';
import type { crearClienteServidor } from '@/lib/supabase/server';
import { SELECT_CIERRE, SELECT_INSPECCION, type CierreCarga, type Inspeccion } from './inspeccion';

type Cliente = Awaited<ReturnType<typeof crearClienteServidor>>;

/**
 * Inspecciones (más reciente primero, con enlaces temporales a las fotos) y datos de cierre
 * de carga de los camiones indicados.
 */
export async function cargarInspecciones(supabase: Cliente, ids: string[]) {
  if (ids.length === 0) return { inspecciones: [] as Inspeccion[], cierres: [] as CierreCarga[], obligatoria: false };
  const [{ data: insp }, { data: cierres }, { data: config }] = await Promise.all([
    supabase.from('inspecciones_camion').select(SELECT_INSPECCION).in('asignacion_id', ids).order('realizada_en', { ascending: false }),
    supabase.from('asignaciones').select(SELECT_CIERRE).in('id', ids),
    supabase.from('configuracion').select('valor').eq('clave', 'inspeccion_obligatoria').maybeSingle(),
  ]);
  const inspecciones = (insp ?? []) as unknown as Inspeccion[];
  const rutas = inspecciones.flatMap((i) => i.fotos);
  if (rutas.length) {
    const { data: firmadas } = await supabase.storage.from('documentos').createSignedUrls(rutas, 60 * 30);
    const enlace = new Map((firmadas ?? []).map((f) => [f.path, f.signedUrl]));
    for (const i of inspecciones) i.enlaces = i.fotos.map((r) => enlace.get(r) ?? null);
  }
  const valor = (config as { valor: unknown } | null)?.valor;
  return {
    inspecciones,
    cierres: (cierres ?? []) as unknown as CierreCarga[],
    obligatoria: valor === true || valor === 'true',
  };
}
