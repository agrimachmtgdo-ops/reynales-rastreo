/**
 * Formato compacto para enviar posiciones por lotes y gastar pocos datos.
 *
 * Cada posición viaja como un arreglo de 6 números enteros:
 *   [segundos_unix, lat×1e5, lon×1e5, velocidad_kmh, precision_m, simulada(0|1)]
 *
 * Ejemplo: [1764273600, -1951234, -6398765, 62, 12, 0]
 * Cinco decimales equivalen a ~1 metro, suficiente para rastrear un camión.
 * La función SQL `registrar_posiciones` entiende este mismo formato.
 */
export type PosicionCompacta = [number, number, number, number, number, 0 | 1];

export interface Posicion {
  /** Momento de captura en milisegundos (Date.now()). */
  capturadoEn: number;
  lat: number;
  lon: number;
  /** Velocidad en km/h (puede ser null si el GPS no la entrega). */
  velocidadKmh: number | null;
  /** Precisión horizontal en metros. */
  precisionM: number | null;
  /** true si Android indica que la ubicación es simulada (app de "GPS falso"). */
  simulada: boolean;
}

export function compactar(p: Posicion): PosicionCompacta {
  return [
    Math.floor(p.capturadoEn / 1000),
    Math.round(p.lat * 1e5),
    Math.round(p.lon * 1e5),
    Math.max(0, Math.round(p.velocidadKmh ?? 0)),
    Math.max(0, Math.round(p.precisionM ?? 0)),
    p.simulada ? 1 : 0,
  ];
}

export function expandir(c: PosicionCompacta): Posicion {
  return {
    capturadoEn: c[0] * 1000,
    lat: c[1] / 1e5,
    lon: c[2] / 1e5,
    velocidadKmh: c[3],
    precisionM: c[4],
    simulada: c[5] === 1,
  };
}

/** Máximo de posiciones por envío (debe coincidir con el límite en SQL). */
export const MAX_POSICIONES_POR_LOTE = 500;

/**
 * Intervalos de captura y envío, en segundos (ver "Consumo mínimo de datos" en el plan).
 */
export const INTERVALOS = {
  capturaEnMovimientoS: 45,
  distanciaMinimaM: 75,
  envioNormalS: 150,
  envioPeruS: 300,
} as const;
