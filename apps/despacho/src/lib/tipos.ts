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
  emergencia_en: string | null;
  emergencia_motivo: string | null;
  /** Desde cuándo el camión no se mueve más de 300 m (lo calcula la base de datos). */
  detenido_desde?: string | null;
  mision: { codigo: string; cliente: { razon_social: string } | null; destino: { nombre: string } | null } | null;
  conductor: { id?: string; nombre: string; telefono?: string | null } | null;
  vehiculo: { placa: string } | null;
}

/** Motivos del botón de emergencia de la app del chofer. */
export const MOTIVO_EMERGENCIA: Record<string, string> = {
  accidente: 'Accidente',
  robo: 'Robo o asalto',
  mecanica: 'Falla mecánica',
  salud: 'Problema de salud',
  otro: 'Otra emergencia',
};
export const textoEmergencia = (motivo: string | null | undefined) => MOTIVO_EMERGENCIA[motivo ?? ''] ?? 'Emergencia';

/** Minutos desde la última señal (null si nunca envió). */
export function minutosSinSenal(ultimaSenal: string | null, ahora = Date.now()): number | null {
  if (!ultimaSenal) return null;
  return Math.floor((ahora - new Date(ultimaSenal).getTime()) / 60000);
}

/**
 * Prioridad para ordenar el tablero "por necesidad de acción":
 * -1 = emergencia activa, 0 = sin señal hace más de 30 min en viaje, 1 = nunca envió, 2 = en frontera, 3 = normal, 4 = programado.
 */
export function prioridad(
  a: Pick<AsignacionEnVivo, 'etapa' | 'ultima_senal' | 'detenido_desde'> & { emergencia_en?: string | null },
  ahora = Date.now(),
  minDetenido = MINUTOS_DETENIDO,
): number {
  if (a.emergencia_en) return -1;
  const min = minutosSinSenal(a.ultima_senal, ahora);
  if (a.etapa === 'programado') return 4;
  if (min !== null && min > 30) return 0;
  if (estaDetenido(a, ahora, minDetenido)) return 0;
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
export type Grupo = 'todos' | 'en_ruta' | 'en_frontera' | 'detenido' | 'sin_senal' | 'programado';

/** Minutos sin moverse para considerar «Detenido» si no hay otra configuración. */
export const MINUTOS_DETENIDO = 30;

/** Minutos que lleva sin moverse más de 300 m (null si no aplica). */
export function minutosDetenido(a: Pick<AsignacionEnVivo, 'detenido_desde'>, ahora = Date.now()): number | null {
  return minutosSinSenal(a.detenido_desde ?? null, ahora);
}

/** En ruta (o ya en Perú), con señal reciente, y sin moverse más de 300 m durante «minDetenido» minutos. */
export function estaDetenido(
  a: Pick<AsignacionEnVivo, 'etapa' | 'ultima_senal' | 'detenido_desde'>,
  ahora = Date.now(),
  minDetenido = MINUTOS_DETENIDO,
): boolean {
  if (a.etapa !== 'en_ruta' && a.etapa !== 'cruzo_frontera') return false;
  const senal = minutosSinSenal(a.ultima_senal, ahora);
  if (senal === null || senal > 30) return false; // sin señal: es otra alerta
  const quieto = minutosDetenido(a, ahora);
  return quieto !== null && quieto >= minDetenido;
}

export function grupoDe(
  a: Pick<AsignacionEnVivo, 'etapa' | 'ultima_senal' | 'detenido_desde'>,
  ahora = Date.now(),
  minDetenido = MINUTOS_DETENIDO,
): Exclude<Grupo, 'todos'> {
  if (a.etapa === 'programado') return 'programado';
  const min = minutosSinSenal(a.ultima_senal, ahora);
  if (min === null || min > 30) return 'sin_senal';
  if (estaDetenido(a, ahora, minDetenido)) return 'detenido';
  if (a.etapa === 'en_frontera') return 'en_frontera';
  return 'en_ruta';
}

/**
 * Lleva un teléfono a formato internacional E.164 (+591 Bolivia, +51 Perú), o null si no se
 * puede deducir con certeza. Mismas reglas que la función normalizar_telefono de la base de datos.
 */
export function normalizarTelefono(telefono: string | null | undefined): string | null {
  let t = (telefono ?? '').replace(/[^0-9+]/g, '');
  if (!t) return null;
  if (t.startsWith('00')) t = `+${t.slice(2)}`;
  const d = t.replace(/\+/g, '');
  if (t.startsWith('+')) {
    if (d.startsWith('591')) return /^591[2-7]\d{7}$/.test(d) ? `+${d}` : null;
    if (d.startsWith('51')) return /^51[1-9]\d{7,8}$/.test(d) ? `+${d}` : null;
    return /^[1-9]\d{7,14}$/.test(d) ? `+${d}` : null;
  }
  if (/^[67]\d{7}$/.test(d)) return `+591${d}`;
  if (/^9\d{8}$/.test(d)) return `+51${d}`;
  if (/^591[67]\d{7}$/.test(d)) return `+${d}`;
  if (/^519\d{8}$/.test(d)) return `+${d}`;
  return null;
}

export const MENSAJE_TELEFONO =
  'Escriba el número con código de país, por ejemplo +59171234567 (Bolivia) o +51987654321 (Perú).';

/** Enlace de WhatsApp a un número. Null si el número no tiene (ni se puede deducir) el código de país. */
export function enlaceWhatsApp(telefono: string | null | undefined, texto?: string): string | null {
  const numero = normalizarTelefono(telefono);
  if (!numero) return null;
  return `https://wa.me/${numero.slice(1)}${texto ? `?text=${encodeURIComponent(texto)}` : ''}`;
}
