import { INTERVALOS, MAX_POSICIONES_POR_LOTE } from '@reynales/shared';
import { supabase } from './supabase';
import { confirmarHasta, contarPendientes, tomarLote } from './cola';
import { guardarEstado, leerEstado } from './estado';
import type { Etapa } from '@reynales/shared';

// Bytes aproximados de cabeceras HTTP + sesión + respuesta por cada envío.
const SOBRECARGA_POR_ENVIO = 1800;
// Tras fallos seguidos, los reintentos se espacian hasta este máximo (cuida los datos del chofer).
const ESPERA_MAXIMA_MS = 15 * 60 * 1000;

export interface RespuestaLote {
  recibidas: number;
  nuevas: number;
  descartadas?: number;
  etapa: Etapa;
  modo_peru: boolean;
  rastrear: boolean;
}

/** Errores que no se arreglan reintentando: este teléfono ya no tiene acceso al viaje. */
function esErrorPermanente(error: { code?: string; message?: string }) {
  return error.code === '42501' || /aceptar la política/i.test(error.message ?? '');
}

let enviando: Promise<RespuestaLote | null> | null = null;

/**
 * Envía las posiciones pendientes en lotes. Devuelve la última respuesta del
 * servidor, o null si no había nada que enviar o no hubo señal.
 * @param forzar ignora el intervalo (ej. al tocar un botón de etapa). Si ya hay un
 *               envío en curso, espera a que termine y vuelve a intentar.
 */
export async function enviarPendientes(forzar = false): Promise<RespuestaLote | null> {
  if (enviando) {
    if (!forzar) return null;
    await enviando.catch(() => null);
  }
  enviando = enviar(forzar);
  try {
    return await enviando;
  } finally {
    enviando = null;
  }
}

async function enviar(forzar: boolean): Promise<RespuestaLote | null> {
  const estado = await leerEstado();
  if (!estado.asignacionId || estado.sinAcceso) return null;

  const intervaloMs = (estado.modoPeru ? INTERVALOS.envioPeruS : INTERVALOS.envioNormalS) * 1000;
  const esperaMs = Math.min(intervaloMs * 2 ** Math.min(estado.fallosSeguidos, 4), ESPERA_MAXIMA_MS);
  const transcurrido = Date.now() - estado.ultimoEnvio;
  // Si el reloj del teléfono se atrasó (transcurrido negativo), se envía igual.
  if (!forzar && transcurrido >= 0 && transcurrido < esperaMs) return null;

  let ultima: RespuestaLote | null = null;
  let bytes = 0;
  try {
    for (;;) {
      const lote = await tomarLote(MAX_POSICIONES_POR_LOTE);
      if (lote.length === 0) break;
      bytes += JSON.stringify(lote).length + SOBRECARGA_POR_ENVIO;
      const { data, error } = await supabase.rpc('registrar_posiciones', {
        p_asignacion: estado.asignacionId,
        p_lote: lote,
      });
      if (error) throw error;
      ultima = data as RespuestaLote;
      await confirmarHasta(lote[lote.length - 1]![0]);
      // recibidas = 0 con rastrear = false: viaje cerrado hace tiempo, no se sigue enviando.
      if (lote.length < MAX_POSICIONES_POR_LOTE || (!ultima.rastrear && ultima.recibidas === 0)) break;
    }
    await guardarEstado({
      ultimoEnvio: Date.now(),
      ultimoEnvioOk: true,
      fallosSeguidos: 0,
      bytesUsados: estado.bytesUsados + bytes,
      ...(ultima ? { etapa: ultima.etapa, modoPeru: ultima.modo_peru } : {}),
    });
    return ultima;
  } catch (err) {
    const error = (err ?? {}) as { code?: string; message?: string };
    if (esErrorPermanente(error)) {
      // Sin acceso: se detiene el GPS para no gastar datos ni batería; la pantalla avisa al chofer.
      await guardarEstado({ ultimoEnvio: Date.now(), ultimoEnvioOk: false, sinAcceso: true, bytesUsados: estado.bytesUsados + bytes });
      const { detenerRastreo } = await import('./rastreo');
      await detenerRastreo();
      return null;
    }
    // Sin señal o error temporal: las posiciones siguen en la cola y se espacia el próximo intento.
    await guardarEstado({
      ultimoEnvio: Date.now(),
      ultimoEnvioOk: false,
      fallosSeguidos: estado.fallosSeguidos + 1,
      bytesUsados: estado.bytesUsados + bytes,
    });
    return null;
  }
}

/** Intenta vaciar la cola por completo (antes de entregar). Devuelve cuántos puntos quedaron sin enviar. */
export async function enviarTodo(): Promise<number> {
  await enviarPendientes(true);
  return contarPendientes();
}
