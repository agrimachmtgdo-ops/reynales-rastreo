/** Lotes de producción por camión y ticket de balanza (ola 1, entrega 1). */

export type Presentacion = 'saco_50' | 'saco_40' | 'big_bag_1200' | 'granel';

export const PRESENTACIONES: { id: Presentacion; nombre: string; kg: number | null; unidad: string }[] = [
  { id: 'saco_50', nombre: 'Sacos de 50 kg', kg: 50, unidad: 'sacos' },
  { id: 'saco_40', nombre: 'Sacos de 40 kg', kg: 40, unidad: 'sacos' },
  { id: 'big_bag_1200', nombre: 'Big bag de 1.200 kg', kg: 1200, unidad: 'big bags' },
  { id: 'granel', nombre: 'Granel', kg: null, unidad: 'kg' },
];

export const nombrePresentacion = (p: string) => PRESENTACIONES.find((x) => x.id === p)?.nombre ?? p;

/** Presentación que sugiere el texto libre del catálogo de productos («Sacos de 50 kg», «Granel»…). */
export function presentacionSugerida(texto: string | null | undefined): Presentacion | null {
  const t = (texto ?? '').toLowerCase();
  if (!t) return null;
  if (t.includes('granel')) return 'granel';
  if (t.includes('big') || t.includes('1200') || t.includes('1.200')) return 'big_bag_1200';
  if (/\b40\b/.test(t)) return 'saco_40';
  if (/\b50\b/.test(t)) return 'saco_50';
  return null;
}

export interface LoteCamion {
  id: string;
  asignacion_id: string;
  producto_id: string;
  lote: string;
  fecha_produccion: string | null;
  presentacion: Presentacion;
  unidades: number | null;
  kg: number;
  producto: { nombre: string } | null;
}

/** «400 sacos (20.000 kg)» o «12.500 kg» en granel. */
export function cantidadLote(l: Pick<LoteCamion, 'presentacion' | 'unidades' | 'kg'>): string {
  const kg = `${Number(l.kg).toLocaleString('es-BO', { maximumFractionDigits: 1 })} kg`;
  if (l.presentacion === 'granel' || l.unidades == null) return kg;
  const p = PRESENTACIONES.find((x) => x.id === l.presentacion);
  const unidad = l.unidades === 1 ? (l.presentacion === 'big_bag_1200' ? 'big bag' : 'saco') : (p?.unidad ?? 'unidades');
  return `${l.unidades.toLocaleString('es-BO')} ${unidad} (${kg})`;
}

/** Tolerancia por defecto entre la suma de los lotes y el neto de balanza (0,5 %). */
export const TOLERANCIA_LOTES_PCT = 0.5;

/**
 * Comparación de los lotes con el neto de balanza: null si falta uno de los dos.
 * `fuera` es true si la diferencia supera la tolerancia.
 */
export function compararLotesBalanza(kgLotes: number | null | undefined, netoT: number | null | undefined, tolerancia = TOLERANCIA_LOTES_PCT) {
  if (kgLotes == null || netoT == null || Number(netoT) <= 0) return null;
  const netoKg = Number(netoT) * 1000;
  const difKg = Number(kgLotes) - netoKg;
  const pct = (Math.abs(difKg) / netoKg) * 100;
  return { difKg, pct, fuera: pct > tolerancia };
}

/** El camión ya salió de fábrica (o va saliendo) y no tiene lotes registrados. */
export const salioSinLotes = (a: { tramo?: number | null; etapa: string; kg_lotes?: number | null }) =>
  (a.tramo ?? 1) === 1 && a.kg_lotes == null && a.etapa !== 'programado' && a.etapa !== 'cancelado';

export const formatoKg = (n: number) => `${n.toLocaleString('es-BO', { maximumFractionDigits: 1 })} kg`;
