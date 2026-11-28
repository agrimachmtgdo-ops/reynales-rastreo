import 'server-only';
import { crearClienteServidor } from '@/lib/supabase/server';
import type { FiltrosCumplimiento, ReporteCumplimiento, TransportistaCumplimiento } from './cumplimiento';

const amable = (m: string) =>
  m.includes('Could not find the function') ? 'falta aplicar la migración de cumplimiento (C4) en Supabase.' : m;

/** OTIF por envío (función de solo lectura reporte_cumplimiento). */
export async function cargarCumplimiento(f: FiltrosCumplimiento): Promise<{ datos: ReporteCumplimiento | null; error?: string }> {
  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.rpc('reporte_cumplimiento', {
    p_desde: f.desde, p_hasta: f.hasta, p_cliente: f.cliente ?? null, p_incoterm: f.incoterm ?? null,
  });
  if (error) return { datos: null, error: amable(error.message) };
  return { datos: data as ReporteCumplimiento };
}

/** Cumplimiento de transportistas (función de solo lectura reporte_transportistas). */
export async function cargarTransportistas(f: FiltrosCumplimiento): Promise<{ lista: TransportistaCumplimiento[]; toleranciaMin: number; error?: string }> {
  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.rpc('reporte_transportistas', { p_desde: f.desde, p_hasta: f.hasta });
  if (error) return { lista: [], toleranciaMin: 60, error: amable(error.message) };
  const d = data as { tolerancia_min: number; transportistas: TransportistaCumplimiento[] };
  return { lista: d.transportistas ?? [], toleranciaMin: d.tolerancia_min };
}
