import { INTERVALOS, MAX_POSICIONES_POR_LOTE } from '@reynales/shared';
import { supabase } from './supabase';
import { confirmarHasta, tomarLote } from './cola';
import { guardarEstado, leerEstado } from './estado';
import type { Etapa } from '@reynales/shared';

// Bytes aproximados de cabeceras HTTP + sesión + respuesta por cada envío.
const SOBRECARGA_POR_ENVIO = 1800;

export interface RespuestaLote {
  recibidas: number;
  nuevas: number;
  etapa: Etapa;
  modo_peru: boolean;
  rastrear: boolean;
}

let enviando = false;

/**
 * Envía las posiciones pendientes en lotes. Devuelve la última respuesta del
 * servidor, o null si no había nada que enviar o no hubo señal.
 * @param forzar ignora el intervalo (ej. al tocar un botón de etapa).
 */
export async function enviarPendientes(forzar = false): Promise<RespuestaLote | null> {
  if (enviando) return null;
  const estado = await leerEstado();
  if (!estado.asignacionId) return null;

  const intervaloMs = (estado.modoPeru ? INTERVALOS.envioPeruS : INTERVALOS.envioNormalS) * 1000;
  if (!forzar && Date.now() - estado.ultimoEnvio < intervaloMs) return null;

  enviando = true;
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
      if (lote.length < MAX_POSICIONES_POR_LOTE || !ultima.rastrear) break;
    }
    await guardarEstado({
      ultimoEnvio: Date.now(),
      ultimoEnvioOk: true,
      bytesUsados: estado.bytesUsados + bytes,
      ...(ultima ? { etapa: ultima.etapa, modoPeru: ultima.modo_peru } : {}),
    });
    return ultima;
  } catch {
    // Sin señal o error temporal: las posiciones siguen en la cola.
    await guardarEstado({ ultimoEnvio: Date.now(), ultimoEnvioOk: false, bytesUsados: estado.bytesUsados + bytes });
    return null;
  } finally {
    enviando = false;
  }
}
