/** Pedidos de clientes: tipos, nombres que ve el usuario y cálculos simples. */

export const INCOTERMS = ['EXW', 'FCA', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP', 'FAS', 'FOB', 'CFR', 'CIF'] as const;
export type Incoterm = (typeof INCOTERMS)[number];

export const ESTADO_PEDIDO: Record<string, string> = {
  borrador: 'Borrador',
  confirmado: 'Confirmado',
  en_ejecucion: 'En ejecución',
  cumplido: 'Cumplido',
  cancelado: 'Cancelado',
};
export const ESTADO_ENVIO: Record<string, string> = {
  planificado: 'Planificado',
  pendiente: 'Confirmado',
  en_curso: 'En curso',
  cumplido: 'Cumplido',
  cancelado: 'Cancelado',
};
export const CAUSAS: { id: string; nombre: string }[] = [
  { id: 'cliente', nombre: 'Pedido del cliente' },
  { id: 'produccion', nombre: 'Producción (falta de producto)' },
  { id: 'transporte', nombre: 'Transporte (sin camión)' },
  { id: 'aduana', nombre: 'Aduana o documentos' },
  { id: 'clima_via', nombre: 'Clima o bloqueo de vía' },
  { id: 'otra', nombre: 'Otra (explique en la nota)' },
];
export const nombreCausa = (c: string) => CAUSAS.find((x) => x.id === c)?.nombre ?? c;

/** Dónde se mide el cumplimiento según el Incoterm: al cargar (EXW) o al entregar en el destino. */
export function hitoPorIncoterm(incoterm: string | null | undefined): 'carga' | 'entrega' {
  return incoterm?.toUpperCase() === 'EXW' ? 'carga' : 'entrega';
}
export const NOMBRE_HITO: Record<string, string> = {
  carga: 'al cargar en fábrica',
  entrega: 'al entregar en el destino',
};

export interface EnvioPedido {
  id: string;
  numero: number;
  toneladas: number;
  fecha_carga_planificada: string | null;
  entrega_comprometida: string | null;
  entrega_vigente: string;
  estado: string;
  camiones_necesarios?: number | null;
}

/** Fecha AAAA-MM-DD como «10/12/2026» (sin cambiar de día por la zona horaria). */
export function formatoFecha(f: string | null | undefined): string {
  if (!f) return '—';
  const [a, m, d] = f.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

export const formatoToneladas = (n: number) => `${n.toLocaleString('es-BO', { maximumFractionDigits: 2 })} t`;

/** Suma de toneladas de los envíos que no están cancelados. */
export function toneladasVivas(envios: Pick<EnvioPedido, 'toneladas' | 'estado'>[]): number {
  return envios.filter((e) => e.estado !== 'cancelado').reduce((s, e) => s + Number(e.toneladas), 0);
}

/** Próxima entrega pendiente (la fecha vigente más cercana). */
export function proximaEntrega(envios: Pick<EnvioPedido, 'entrega_vigente' | 'estado'>[]): string | null {
  return envios.filter((e) => e.estado === 'planificado' || e.estado === 'pendiente' || e.estado === 'en_curso')
    .map((e) => e.entrega_vigente).sort().at(0) ?? null;
}

/** Lo programado puede superar lo pedido hasta 3 % (peso real de cada camión). */
export const TOLERANCIA = 0.03;
/** Toneladas que suele llevar un camión (para estimar cuántos camiones lleva un envío). */
export const TONELADAS_POR_CAMION = 29;

export const plural = (n: number, uno: string, varios: string) => `${n.toLocaleString('es-BO', { maximumFractionDigits: 2 })} ${n === 1 ? uno : varios}`;

/** Suma días a una fecha AAAA-MM-DD. */
export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/**
 * Reparte unas toneladas en camiones con carga pareja: los menos camiones posibles sin pasar
 * en más de 5 % la capacidad indicada (ej. 150 t a 29 t → 5 camiones de 30 t; 100 t → 4 de 25 t).
 */
export function dividirEnCamiones(total: number, porCamion: number, primeraEntrega: string, cadaDias: number) {
  if (!(total > 0) || !(porCamion > 0) || !primeraEntrega) return [];
  const n = Math.max(1, Math.ceil(total / (porCamion * 1.05) - 1e-9));
  const base = Math.floor((total / n) * 100) / 100;
  const ultimo = Math.round((total - base * (n - 1)) * 100) / 100; // el último absorbe los centésimos
  return Array.from({ length: n }, (_, i) => ({
    toneladas: i === n - 1 ? ultimo : base,
    entrega: sumarDias(primeraEntrega, i * Math.max(0, cadaDias)),
  }));
}

/** Camión (tramo 1) de un envío, para calcular lo despachado. */
export interface CamionDespacho { etapa: string; toneladas_cargadas: number | null }

/**
 * Toneladas enviadas (salieron de fábrica), entregadas, en camino y saldo por despachar de un envío.
 * Un camión sin peso de balanza se estima con las toneladas del envío entre los camiones necesarios.
 */
export function resumenDespacho(toneladas: number, camionesNecesarios: number | null | undefined, camiones: CamionDespacho[]) {
  const programadas = Number(toneladas) || 0;
  const necesarios = Math.max(1, camionesNecesarios || Math.ceil(programadas / TONELADAS_POR_CAMION) || 1);
  const porCamion = programadas / necesarios;
  const salidos = camiones.filter((c) => c.etapa !== 'programado' && c.etapa !== 'cancelado');
  const peso = (c: CamionDespacho) => (c.toneladas_cargadas != null ? Number(c.toneladas_cargadas) : porCamion);
  const enviadas = salidos.reduce((t, c) => t + peso(c), 0);
  const entregadas = salidos.filter((c) => c.etapa === 'entregado').reduce((t, c) => t + peso(c), 0);
  const saldo = Math.max(0, programadas - enviadas);
  return {
    programadas, porCamion, enviadas, entregadas, saldo,
    enCamino: Math.max(0, enviadas - entregadas),
    camionesSalidos: salidos.length,
    sinPeso: salidos.filter((c) => c.toneladas_cargadas == null).length,
    camionesSaldo: porCamion > 0 ? Math.ceil(saldo / porCamion - 0.03) : 0,
  };
}
