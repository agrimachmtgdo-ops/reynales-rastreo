import type { Etapa } from '@reynales/shared';

export interface Opcion {
  id: string;
  nombre: string;
}

export interface AsignacionEnVivo {
  id: string;
  mision_id: string;
  etapa: Etapa;
  ultima_lat: number | null;
  ultima_lon: number | null;
  ultima_velocidad_kmh: number | null;
  ultima_senal: string | null;
  toneladas_cargadas: number | null;
  mision: { codigo: string; cliente: { razon_social: string } | null; destino: { nombre: string } | null } | null;
  conductor: { nombre: string } | null;
  vehiculo: { placa: string } | null;
}

/** Minutos desde la última señal (null si nunca envió). */
export function minutosSinSenal(ultimaSenal: string | null, ahora = Date.now()): number | null {
  if (!ultimaSenal) return null;
  return Math.floor((ahora - new Date(ultimaSenal).getTime()) / 60000);
}

/**
 * Prioridad para ordenar el tablero "por necesidad de acción":
 * 0 = sin señal hace más de 30 min en viaje, 1 = nunca envió, 2 = en frontera, 3 = normal, 4 = programado.
 */
export function prioridad(a: Pick<AsignacionEnVivo, 'etapa' | 'ultima_senal'>, ahora = Date.now()): number {
  const min = minutosSinSenal(a.ultima_senal, ahora);
  if (a.etapa === 'programado') return 4;
  if (min !== null && min > 30) return 0;
  if (min === null) return 1;
  if (a.etapa === 'en_frontera') return 2;
  return 3;
}

export function formatoHora(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('es-BO', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/La_Paz',
  }).format(new Date(iso));
}
