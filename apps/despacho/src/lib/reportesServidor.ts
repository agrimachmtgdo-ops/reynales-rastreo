import 'server-only';
import { crearClienteServidor } from '@/lib/supabase/server';
import type { FiltrosReporte, FilaReporte } from './reportes';

/** Llama a la función de solo lectura reporte_entregas con los filtros. */
export async function cargarReporte(f: FiltrosReporte): Promise<{ filas: FilaReporte[]; error?: string }> {
  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.rpc('reporte_entregas', {
    p_desde: f.desde, p_hasta: f.hasta,
    p_cliente: f.cliente ?? null, p_pais: f.pais ?? null, p_transportista: f.transportista ?? null,
  });
  if (error) return { filas: [], error: error.message };
  const filas = (data ?? []) as FilaReporte[];
  // El producto se toma de la misión (catálogo); si no tiene enlace, se muestra el texto anterior.
  const productoDe = new Map<string, { id: string | null; nombre: string | null }>();
  for (let i = 0; i < filas.length; i += 200) {
    const ids = filas.slice(i, i + 200).map((x) => x.id);
    const { data: misiones } = await supabase.from('misiones')
      .select('id, producto_id, tipo_carga, producto:productos(nombre, codigo)').in('id', ids);
    for (const m of (misiones ?? []) as unknown as { id: string; producto_id: string | null; tipo_carga: string | null; producto: { nombre: string; codigo: string | null } | null }[]) {
      productoDe.set(m.id, { id: m.producto_id, nombre: m.producto?.nombre ?? (m.tipo_carga ? `${m.tipo_carga} (sin catálogo)` : null) });
    }
  }
  const conProducto = filas.map((x) => ({ ...x, producto_id: productoDe.get(x.id)?.id ?? null, producto: productoDe.get(x.id)?.nombre ?? null }));
  return { filas: f.producto ? conProducto.filter((x) => x.producto_id === f.producto) : conProducto };
}
