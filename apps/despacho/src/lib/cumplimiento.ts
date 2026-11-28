/**
 * Cumplimiento (fase C4). La base de datos devuelve una fila por envío medido
 * (public.reporte_cumplimiento) y una por transportista (public.reporte_transportistas);
 * aquí se arman los porcentajes, la serie semanal, la tabla por cliente y las causas.
 */
import { hoyBolivia } from './reportes';
import { nombreCausa } from './pedidos';

export type Medicion = 'medido' | 'vencido' | 'cancelado';

export interface EnvioCumplimiento {
  envio_id: string;
  pedido_id: string;
  pedido_codigo: string;
  numero: number;
  cliente_id: string;
  cliente: string;
  incoterm: string;
  destino: string | null;
  hito: 'carga' | 'entrega';
  comprometida: string;
  fecha_real: string | null;
  embarque: string | null;
  medicion: Medicion;
  a_tiempo: boolean;
  completo: boolean | null;
  otif: boolean | null;
  dias_atraso: number | null;
  toneladas_comprometidas: number;
  toneladas_reales: number | null;
  causa: string | null;
  mision_id: string | null;
  mision_codigo: string | null;
}

export interface AjustesCumplimiento {
  tolerancia_dias: number;
  tolerancia_pct: number;
  meta_pct: number;
  tolerancia_min: number;
}

export interface ReporteCumplimiento {
  ajustes: AjustesCumplimiento;
  hoy: string;
  solo_propios: boolean;
  envios: EnvioCumplimiento[];
}

export interface AusenciaTransportista {
  placa: string;
  chofer: string;
  causa: string;
  carga: string;
  pedido_codigo: string;
  numero: number;
}

export interface TransportistaCumplimiento {
  transportista_id: string;
  transportista: string;
  pedidos: number;
  respondidos: number;
  confirmados: number;
  sin_respuesta: number;
  asignados: number;
  llegaron: number;
  ausencias: number;
  con_hora: number;
  puntuales: number;
  detalle_ausencias: AusenciaTransportista[];
}

export interface FiltrosCumplimiento {
  desde: string;
  hasta: string;
  cliente?: string;
  incoterm?: string;
  vista: 'envios' | 'transportistas';
}

export const INCOTERMS = ['CPT', 'FCA', 'FOB', 'EXW', 'DAP', 'CIF'] as const;

const DIA = 86_400_000;
const fechaValida = (f?: string) => !!f && /^\d{4}-\d{2}-\d{2}$/.test(f) && !Number.isNaN(Date.parse(f));
const uuidValido = (v?: string) => !!v && /^[0-9a-f-]{36}$/i.test(v);
const sumarDias = (f: string, d: number) => new Date(Date.parse(`${f}T00:00:00Z`) + d * DIA).toISOString().slice(0, 10);

/** Filtros desde la dirección de la página; por defecto, el mes en curso. */
export function leerFiltrosCumplimiento(p: Record<string, string | string[] | undefined>, hoy = hoyBolivia()): FiltrosCumplimiento {
  const t = (k: string) => (typeof p[k] === 'string' ? (p[k] as string) : undefined);
  let desde = fechaValida(t('desde')) ? t('desde')! : `${hoy.slice(0, 7)}-01`;
  let hasta = fechaValida(t('hasta')) ? t('hasta')! : hoy;
  if (hasta < desde) [desde, hasta] = [hasta, desde];
  if (Date.parse(hasta) - Date.parse(desde) > 400 * DIA) desde = sumarDias(hasta, -400);
  const incoterm = (INCOTERMS as readonly string[]).includes(t('incoterm') ?? '') ? t('incoterm') : undefined;
  return {
    desde, hasta, incoterm,
    cliente: uuidValido(t('cliente')) ? t('cliente') : undefined,
    vista: t('vista') === 'transportistas' ? 'transportistas' : 'envios',
  };
}

export function parametrosCumplimiento(f: FiltrosCumplimiento, cambios: Partial<FiltrosCumplimiento> = {}): string {
  const g = { ...f, ...cambios };
  const p = new URLSearchParams({ desde: g.desde, hasta: g.hasta });
  if (g.cliente) p.set('cliente', g.cliente);
  if (g.incoterm) p.set('incoterm', g.incoterm);
  if (g.vista === 'transportistas') p.set('vista', 'transportistas');
  return p.toString();
}

const pct = (a: number, b: number) => (b > 0 ? a / b : null);

export interface ResumenCumplimiento {
  medidos: number;
  otif: number;
  conOtif: number;
  aTiempo: number;
  completos: number;
  conPeso: number;
  vencidos: number;
  cancelados: number;
  pctOtif: number | null;
  pctATiempo: number | null;
  pctCompleto: number | null;
  diasAtrasoPromedio: number | null;
  toneladasFaltantes: number;
}

/** Totales: el OTIF se calcula sobre los envíos con resultado conocido (los que aún no tienen peso quedan fuera). */
export function resumirCumplimiento(envios: EnvioCumplimiento[]): ResumenCumplimiento {
  const conOtif = envios.filter((e) => e.otif !== null);
  const conPeso = envios.filter((e) => e.completo !== null);
  const tarde = envios.filter((e) => !e.a_tiempo && e.medicion !== 'cancelado');
  return {
    medidos: envios.length,
    otif: conOtif.filter((e) => e.otif).length,
    conOtif: conOtif.length,
    aTiempo: envios.filter((e) => e.a_tiempo).length,
    completos: conPeso.filter((e) => e.completo).length,
    conPeso: conPeso.length,
    vencidos: envios.filter((e) => e.medicion === 'vencido').length,
    cancelados: envios.filter((e) => e.medicion === 'cancelado').length,
    pctOtif: pct(conOtif.filter((e) => e.otif).length, conOtif.length),
    pctATiempo: pct(envios.filter((e) => e.a_tiempo).length, envios.length),
    pctCompleto: pct(conPeso.filter((e) => e.completo).length, conPeso.length),
    diasAtrasoPromedio: tarde.length ? tarde.reduce((s, e) => s + (e.dias_atraso ?? 0), 0) / tarde.length : null,
    toneladasFaltantes: envios.reduce((s, e) =>
      e.completo === false && e.toneladas_reales !== null ? s + Math.max(0, Number(e.toneladas_comprometidas) - Number(e.toneladas_reales)) : s, 0),
  };
}

/** Lunes de la semana de una fecha AAAA-MM-DD. */
export function lunesDe(f: string): string {
  const d = new Date(`${f}T00:00:00Z`);
  return sumarDias(f, -((d.getUTCDay() + 6) % 7));
}

/** OTIF por semana de la fecha comprometida, de la primera a la última semana del período. */
export function otifPorSemana(envios: EnvioCumplimiento[], f: Pick<FiltrosCumplimiento, 'desde' | 'hasta'>) {
  const semanas: { semana: string; medidos: number; otif: number; pct: number | null }[] = [];
  for (let s = lunesDe(f.desde); s <= f.hasta; s = sumarDias(s, 7)) {
    const lista = envios.filter((e) => e.otif !== null && lunesDe(e.comprometida) === s);
    const ok = lista.filter((e) => e.otif).length;
    semanas.push({ semana: s, medidos: lista.length, otif: ok, pct: pct(ok, lista.length) });
  }
  return semanas;
}

/** Por cliente, de peor a mejor OTIF. */
export function cumplimientoPorCliente(envios: EnvioCumplimiento[]) {
  const mapa = new Map<string, EnvioCumplimiento[]>();
  for (const e of envios) mapa.set(e.cliente_id, [...(mapa.get(e.cliente_id) ?? []), e]);
  return [...mapa.values()].map((lista) => ({ cliente_id: lista[0]!.cliente_id, cliente: lista[0]!.cliente, ...resumirCumplimiento(lista) }))
    .sort((a, b) => (a.pctOtif ?? 2) - (b.pctOtif ?? 2) || a.cliente.localeCompare(b.cliente));
}

/** Causas de las fallas (Pareto), de la más frecuente a la menos. */
export function causasDeFalla(envios: EnvioCumplimiento[]) {
  const fallas = envios.filter((e) => e.otif === false);
  const cuenta = new Map<string, number>();
  for (const e of fallas) {
    const k = e.causa ?? 'sin_registrar';
    cuenta.set(k, (cuenta.get(k) ?? 0) + 1);
  }
  return [...cuenta.entries()]
    .map(([causa, n]) => ({ causa, nombre: textoCausa(causa), fallas: n, pct: n / fallas.length }))
    .sort((a, b) => b.fallas - a.fallas || a.nombre.localeCompare(b.nombre));
}

export const textoCausa = (c: string | null) => (!c || c === 'sin_registrar' ? 'Sin causa registrada' : nombreCausa(c));

/** Motivo legible de que un envío no sea OTIF. */
export function motivoFalla(e: EnvioCumplimiento): string {
  if (e.medicion === 'cancelado') return 'Cancelado';
  if (e.medicion === 'vencido') return `Vencido sin ${e.hito === 'carga' ? 'cargar' : 'entregar'}`;
  const partes: string[] = [];
  if (!e.a_tiempo) partes.push(`${e.dias_atraso} ${e.dias_atraso === 1 ? 'día' : 'días'} tarde`);
  if (e.completo === false) partes.push('Incompleto');
  return partes.join(' · ') || '—';
}

export interface FichaCumplimiento extends TransportistaCumplimiento {
  pctConfirmacion: number | null;
  pctPresentacion: number | null;
  pctPuntualidad: number | null;
}

/** Fichas de transportistas, de peor a mejor (primero quien más falla en presentarse). */
export function fichasCumplimiento(lista: TransportistaCumplimiento[]): FichaCumplimiento[] {
  return lista.map((t) => ({
    ...t,
    pctConfirmacion: pct(t.confirmados, t.respondidos),
    pctPresentacion: pct(t.llegaron, t.asignados),
    pctPuntualidad: pct(t.puntuales, t.con_hora),
  })).sort((a, b) =>
    (a.pctPresentacion ?? 2) - (b.pctPresentacion ?? 2)
    || (a.pctConfirmacion ?? 2) - (b.pctConfirmacion ?? 2)
    || (a.pctPuntualidad ?? 2) - (b.pctPuntualidad ?? 2)
    || a.transportista.localeCompare(b.transportista));
}
