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
  pendiente: 'Pendiente',
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
  return envios.filter((e) => e.estado === 'pendiente' || e.estado === 'en_curso')
    .map((e) => e.entrega_vigente).sort().at(0) ?? null;
}
