import Storage from 'expo-sqlite/kv-store';
import type { Etapa } from '@reynales/shared';
import { vaciarCola } from './cola';
import type { Viaje } from './tipos';

/**
 * Estado pequeño que comparten la pantalla y la tarea en segundo plano
 * (se guarda en el teléfono para sobrevivir si Android cierra la app).
 */
export interface EstadoRastreo {
  asignacionId: string | null;
  etapa: Etapa | null;
  modoPeru: boolean;
  ultimoEnvio: number;          // ms
  ultimoEnvioOk: boolean;
  bytesUsados: number;          // datos aproximados gastados en este viaje
  ultimoGuardado: { t: number; lat: number; lon: number } | null;
  ultimaVelocidadKmh: number;
  fallosSeguidos: number;       // envíos fallidos seguidos (para espaciar reintentos)
  /** El servidor rechazó el acceso de este teléfono (sesión perdida): no se reintenta. */
  sinAcceso: boolean;
  /** Copia del viaje para mostrarlo y seguir rastreando aunque la app abra sin señal. */
  viaje: Viaje | null;
}

const CLAVE = 'estado_rastreo_v1';
const INICIAL: EstadoRastreo = {
  asignacionId: null,
  etapa: null,
  modoPeru: false,
  ultimoEnvio: 0,
  ultimoEnvioOk: true,
  bytesUsados: 0,
  ultimoGuardado: null,
  ultimaVelocidadKmh: 0,
  fallosSeguidos: 0,
  sinAcceso: false,
  viaje: null,
};

export async function leerEstado(): Promise<EstadoRastreo> {
  try {
    const crudo = await Storage.getItem(CLAVE);
    return crudo ? { ...INICIAL, ...(JSON.parse(crudo) as Partial<EstadoRastreo>) } : { ...INICIAL };
  } catch {
    return { ...INICIAL };
  }
}

export async function guardarEstado(cambios: Partial<EstadoRastreo>): Promise<EstadoRastreo> {
  const nuevo = { ...(await leerEstado()), ...cambios };
  await Storage.setItem(CLAVE, JSON.stringify(nuevo));
  return nuevo;
}

/**
 * Empieza un viaje nuevo en este teléfono. Si es otro viaje, se borran los puntos
 * pendientes del anterior para que no se mezclen con el nuevo recorrido.
 */
export async function reiniciarEstado(asignacionId: string | null, etapa: Etapa | null, viaje: Viaje | null = null) {
  const actual = await leerEstado();
  if (actual.asignacionId !== asignacionId) await vaciarCola();
  await Storage.setItem(CLAVE, JSON.stringify({ ...INICIAL, asignacionId, etapa, viaje }));
}
