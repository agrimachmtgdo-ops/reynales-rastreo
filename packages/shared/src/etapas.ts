/**
 * Etapas de una asignación (un camión dentro de una misión).
 * Deben coincidir con el tipo `etapa_envio` de la base de datos.
 */
export const ETAPAS = [
  'programado',
  'cargado',
  'en_ruta',
  'en_frontera',
  'cruzo_frontera',
  'entregado',
  'cancelado',
] as const;

export type Etapa = (typeof ETAPAS)[number];

export const ETIQUETA_ETAPA: Record<Etapa, string> = {
  programado: 'Programado',
  cargado: 'Cargado',
  en_ruta: 'En ruta',
  en_frontera: 'En frontera / aduana',
  cruzo_frontera: 'Cruzó frontera',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
};

/** Etapas en las que el GPS del chofer debe estar encendido. */
export const ETAPAS_CON_RASTREO: readonly Etapa[] = ['cargado', 'en_ruta', 'en_frontera', 'cruzo_frontera'];

/** Etapas que el chofer puede marcar con un botón. */
export type EtapaChofer = 'cargado' | 'en_frontera' | 'entregado';
