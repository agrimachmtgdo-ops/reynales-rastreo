'use server';
import { revalidatePath } from 'next/cache';
import { crearClienteServidor } from '@/lib/supabase/server';
import type { Resultado } from '../misiones/acciones';

const texto = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
};

function refrescar(misionId: string) {
  revalidatePath(`/misiones/${misionId}`);
  revalidatePath('/almacen', 'layout');
}

export interface DatosInspeccion {
  puntos: Record<string, boolean>;
  cargaAnterior: string | null;
  resultado: 'aprobado' | 'rechazado';
  motivo: string | null;
  fotos: string[];
}

/** ALMACÉN: registra la inspección del camión (las fotos ya están subidas en <misión>/insp-…). */
export async function registrarInspeccion(asignacionId: string, misionId: string, d: DatosInspeccion): Promise<Resultado> {
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc('registrar_inspeccion', {
    p_asignacion: asignacionId, p_puntos: d.puntos, p_carga_anterior: d.cargaAnterior, p_resultado: d.resultado,
    p_motivo: d.motivo, p_fotos: d.fotos,
  });
  if (error) return { ok: false, mensaje: error.message };
  refrescar(misionId);
  return {
    ok: true,
    mensaje: d.resultado === 'aprobado'
      ? 'Inspección aprobada. Ya puede cargar el camión.'
      : 'Camión rechazado. Que lo limpien y vuelva a inspeccionarlo.',
  };
}

/** ALMACÉN: cierra la carga con el número de precinto. */
export async function cerrarCarga(asignacionId: string, misionId: string, _: Resultado | null, f: FormData): Promise<Resultado> {
  const precinto = texto(f, 'precinto');
  if (!precinto) return { ok: false, mensaje: 'Escriba el número de precinto.', campo: 'precinto', errorCampo: 'Dato obligatorio.' };
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc('cerrar_carga', { p_asignacion: asignacionId, p_precinto: precinto });
  if (error) return { ok: false, mensaje: error.message };
  refrescar(misionId);
  return { ok: true, mensaje: `Carga cerrada con precinto ${precinto.toUpperCase()}. El chofer ya puede iniciar el viaje.` };
}

/** ADMINISTRADOR: libera un camión por excepción (sale sin inspección aprobada o sin carga cerrada). */
export async function liberarCamion(asignacionId: string, misionId: string, _: Resultado | null, f: FormData): Promise<Resultado> {
  const motivo = texto(f, 'motivo');
  if (!motivo || motivo.length < 5) return { ok: false, mensaje: 'Escriba el motivo de la excepción.', campo: 'motivo', errorCampo: 'Al menos 5 letras.' };
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc('liberar_camion', { p_asignacion: asignacionId, p_motivo: motivo });
  if (error) return { ok: false, mensaje: error.message };
  refrescar(misionId);
  return { ok: true, mensaje: 'Camión liberado por excepción. Queda registrado en el historial.' };
}

/** ADMINISTRADOR: bloqueo (true) o solo alerta (false). */
export async function fijarInspeccionObligatoria(_: Resultado | null, f: FormData): Promise<Resultado> {
  const valor = f.get('valor') === 'true';
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc('fijar_inspeccion_obligatoria', { p_valor: valor });
  if (error) return { ok: false, mensaje: error.message };
  revalidatePath('/almacen', 'layout');
  return {
    ok: true,
    mensaje: valor
      ? 'Bloqueo activado: sin inspección aprobada no se carga, y sin carga cerrada el camión no sale.'
      : 'Modo alerta: los camiones salen igual y queda una alerta si faltó la inspección o el precinto.',
  };
}
