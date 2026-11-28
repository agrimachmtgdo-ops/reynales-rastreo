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
  conductor: { nombre: string; telefono?: string | null } | null;
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

/** "hace 12 min", "hace 3 h" o "nunca". La hora exacta va en el title del elemento. */
export function haceCuanto(iso: string | null, ahora = Date.now()): string {
  const min = minutosSinSenal(iso, ahora);
  if (min === null) return 'nunca';
  if (min < 1) return 'hace menos de 1 min';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} días`;
}

/** Grupos del resumen del tablero. */
export type Grupo = 'todos' | 'en_ruta' | 'en_frontera' | 'sin_senal' | 'programado';

export function grupoDe(a: Pick<AsignacionEnVivo, 'etapa' | 'ultima_senal'>, ahora = Date.now()): Exclude<Grupo, 'todos'> {
  if (a.etapa === 'programado') return 'programado';
  const min = minutosSinSenal(a.ultima_senal, ahora);
  if (min === null || min > 30) return 'sin_senal';
  if (a.etapa === 'en_frontera') return 'en_frontera';
  return 'en_ruta';
}

/** Enlace de WhatsApp a un número (o null si no hay número usable). */
export function enlaceWhatsApp(telefono: string | null | undefined, texto?: string): string | null {
  const numero = (telefono ?? '').replace(/[^0-9]/g, '');
  if (numero.length < 8) return null;
  return `https://wa.me/${numero}${texto ? `?text=${encodeURIComponent(texto)}` : ''}`;
}
