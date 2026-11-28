import 'server-only';
import type { crearClienteServidor } from '@/lib/supabase/server';
import { SELECT_PRUEBA, type PruebaEntrega } from './entrega';

type Cliente = Awaited<ReturnType<typeof crearClienteServidor>>;

/**
 * Pruebas de entrega de los camiones indicados, con enlaces temporales a las fotos ya subidas.
 * Devuelve null si la base aún no tiene la prueba de entrega (migración sin aplicar).
 */
export async function cargarPruebas(supabase: Cliente, ids: string[]): Promise<PruebaEntrega[] | null> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase.from('pruebas_entrega').select(SELECT_PRUEBA).in('asignacion_id', ids);
  if (error) return null;
  const pruebas = (data ?? []) as unknown as PruebaEntrega[];
  const rutas = pruebas.flatMap((p) => p.fotos_subidas ?? []);
  if (rutas.length) {
    const { data: firmadas } = await supabase.storage.from('documentos').createSignedUrls(rutas, 60 * 30);
    const enlace = new Map((firmadas ?? []).map((f) => [f.path, f.signedUrl]));
    for (const p of pruebas) {
      p.enlaceGuia = p.foto_guia ? enlace.get(p.foto_guia) ?? null : null;
      p.enlacesNovedad = (p.fotos_novedad ?? []).map((r) => enlace.get(r) ?? null);
    }
  }
  return pruebas;
}
