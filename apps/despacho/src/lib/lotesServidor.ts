import { crearClienteServidor } from '@/lib/supabase/server';
import type { Presentacion } from './lotes';

/** Una fila de la búsqueda por lote: dónde fue cada lote. */
export interface FilaLote {
  lote: string;
  producto: string;
  presentacion: Presentacion;
  unidades: number | null;
  kg: number;
  fecha_produccion: string | null;
  asignacion_id: string;
  placa: string | null;
  transportista: string | null;
  etapa: string;
  mision_id: string;
  mision: string;
  cliente: string;
  pais_cliente: string;
  destino: string;
  pedido: string | null;
  pedido_id: string | null;
  factura: string | null;
  salida: string | null;
  entrega: string | null;
}

/** Busca un lote (por el comienzo del número, sin importar mayúsculas). */
export async function buscarLote(texto: string): Promise<{ filas: FilaLote[]; error: string | null }> {
  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.rpc('buscar_lote', { p_texto: texto });
  return { filas: (data ?? []) as FilaLote[], error: error?.message ?? null };
}
