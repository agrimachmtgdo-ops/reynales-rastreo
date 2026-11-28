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
  return { filas: (data ?? []) as FilaReporte[] };
}
