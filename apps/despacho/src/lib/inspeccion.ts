/** Inspección del camión y cierre de carga en fábrica (ola 1, entrega 2). */

/** Los 6 puntos de la lista (mismas claves que puntos_inspeccion() en la base). */
export const PUNTOS_INSPECCION: { id: string; texto: string }[] = [
  { id: 'piso_limpio_seco', texto: 'Piso limpio y seco' },
  { id: 'sin_olores', texto: 'Sin olores extraños' },
  { id: 'sin_plagas_restos', texto: 'Sin insectos ni restos de carga' },
  { id: 'carroceria_sana', texto: 'Carrocería sin huecos ni clavos salientes' },
  { id: 'lona_buena', texto: 'Lona o carpa sin roturas' },
  { id: 'carga_compatible', texto: 'Carga anterior compatible (no químicos, fertilizantes ni combustibles)' },
];

export const textoPunto = (id: string) => PUNTOS_INSPECCION.find((p) => p.id === id)?.texto ?? id;

export interface Inspeccion {
  id: string;
  asignacion_id: string;
  realizada_en: string;
  puntos: Record<string, boolean>;
  carga_anterior: string | null;
  resultado: 'aprobado' | 'rechazado';
  motivo: string | null;
  fotos: string[];
  inspector_nombre: string | null;
  /** Enlaces firmados (temporales) de las fotos, en el mismo orden. */
  enlaces?: (string | null)[];
}

/** Datos del cierre de carga de un camión (tramo 1). */
export interface CierreCarga {
  id: string;
  etapa: string;
  tramo?: number | null;
  precinto: string | null;
  inicio_carga: string | null;
  fin_carga: string | null;
  liberado_en: string | null;
  liberado_motivo: string | null;
}

export type EstadoCarga = 'sin_inspeccion' | 'rechazado' | 'cargando' | 'cerrada' | 'liberado';

/** En qué paso está la carga del camión. `inspecciones` ordenadas de la más reciente a la más antigua. */
export function estadoCarga(c: CierreCarga, inspecciones: Pick<Inspeccion, 'resultado'>[]): EstadoCarga {
  if (c.fin_carga) return 'cerrada';
  const ultima = inspecciones[0];
  if (ultima?.resultado === 'aprobado') return 'cargando';
  if (c.liberado_en) return 'liberado';
  if (ultima?.resultado === 'rechazado') return 'rechazado';
  return 'sin_inspeccion';
}

export const TEXTO_ESTADO_CARGA: Record<EstadoCarga, string> = {
  sin_inspeccion: 'Por inspeccionar',
  rechazado: 'Rechazado: limpiar e inspeccionar de nuevo',
  cargando: 'Inspección aprobada: cargando',
  cerrada: 'Carga cerrada',
  liberado: 'Liberado por el administrador',
};

export const SELECT_INSPECCION = 'id, asignacion_id, realizada_en, puntos, carga_anterior, resultado, motivo, fotos, inspector_nombre';
export const SELECT_CIERRE = 'id, etapa, tramo, precinto, inicio_carga, fin_carga, liberado_en, liberado_motivo';

/** Hora corta de Bolivia («28/11 14:05»). */
export const horaCorta = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('es-BO', { timeZone: 'America/La_Paz', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
