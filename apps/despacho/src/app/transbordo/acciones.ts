'use server';
import { revalidatePath } from 'next/cache';
import { crearClienteServidor } from '@/lib/supabase/server';
import { MENSAJE_TELEFONO, normalizarTelefono } from '@/lib/tipos';
import type { DatosDocumento } from '@/lib/documentos';

export interface Resultado {
  ok: boolean;
  mensaje: string;
  campo?: string;
  errorCampo?: string;
}

const texto = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
};
const numero = (f: FormData, k: string) => {
  const v = texto(f, k);
  return v === null ? null : Number(v.replace(',', '.'));
};

/** Mensaje del servidor sin detalles técnicos. */
const limpio = (m: string) => m.replace(/^.*?ERROR:\s*/, '');

/**
 * Agrega un camión al tramo del operador. El camión y el chofer pueden ser nuevos:
 * se registran en el mismo paso (si la placa o el CI ya existen en su empresa, se reutilizan).
 */
export async function agregarCamionOperador(misionId: string, _: Resultado | null, f: FormData): Promise<Resultado> {
  const placa = texto(f, 'placa');
  if (!placa) return { ok: false, mensaje: 'Escriba la placa del camión.', campo: 'placa', errorCampo: 'Dato obligatorio.' };
  const toneladas = numero(f, 'toneladas');
  if (toneladas === null || Number.isNaN(toneladas) || toneladas <= 0) {
    return { ok: false, mensaje: 'Escriba las toneladas que lleva el camión.', campo: 'toneladas', errorCampo: 'Escriba un número, por ejemplo 14,5.' };
  }
  const precinto = texto(f, 'precinto');
  if (!precinto) return { ok: false, mensaje: 'Escriba el número de precinto.', campo: 'precinto', errorCampo: 'Dato obligatorio.' };

  const supabase = await crearClienteServidor();
  let conductor = texto(f, 'conductor_id');
  if (!conductor || conductor === 'nuevo') {
    const nombre = texto(f, 'chofer_nombre');
    if (!nombre) return { ok: false, mensaje: 'Escriba el nombre del chofer.', campo: 'chofer_nombre', errorCampo: 'Dato obligatorio.' };
    const telefono = normalizarTelefono(texto(f, 'chofer_telefono'));
    if (!telefono) {
      return { ok: false, mensaje: 'Revise el WhatsApp del chofer: necesita el código de país.', campo: 'chofer_telefono', errorCampo: MENSAJE_TELEFONO };
    }
    const { data, error } = await supabase.rpc('operador_guardar_conductor', {
      p_nombre: nombre, p_telefono: telefono, p_ci: texto(f, 'chofer_ci'), p_licencia: null,
    });
    if (error) return { ok: false, mensaje: limpio(error.message) };
    conductor = data as string;
  }
  const { data: vehiculo, error: errorVehiculo } = await supabase.rpc('operador_guardar_vehiculo', {
    p_placa: placa, p_marca: null, p_capacidad: null,
  });
  if (errorVehiculo) return { ok: false, mensaje: limpio(errorVehiculo.message), campo: 'placa', errorCampo: 'Revise la placa.' };

  const { error } = await supabase.rpc('operador_agregar_camion', {
    p_mision: misionId, p_conductor: conductor, p_vehiculo: vehiculo as string, p_toneladas: toneladas, p_precinto: precinto,
  });
  if (error) return { ok: false, mensaje: limpio(error.message) };
  revalidatePath(`/transbordo/${misionId}`);
  return { ok: true, mensaje: 'Camión registrado. Envíe al chofer el código de la app que aparece en su tarjeta.' };
}

export async function corregirCamionOperador(asignacionId: string, misionId: string, _: Resultado | null, f: FormData): Promise<Resultado> {
  const toneladas = numero(f, 'toneladas');
  if (toneladas === null || Number.isNaN(toneladas) || toneladas <= 0) {
    return { ok: false, mensaje: 'Escriba las toneladas.', campo: 'toneladas', errorCampo: 'Escriba un número, por ejemplo 14,5.' };
  }
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc('operador_corregir_camion', {
    p_asignacion: asignacionId, p_toneladas: toneladas, p_precinto: texto(f, 'precinto') ?? '',
  });
  if (error) return { ok: false, mensaje: limpio(error.message) };
  revalidatePath(`/transbordo/${misionId}`);
  return { ok: true, mensaje: 'Datos corregidos.' };
}

export async function recibiCarga(asignacionId: string, misionId: string, _: Resultado | null, f: FormData): Promise<Resultado> {
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc('operador_recibi_carga', { p_asignacion: asignacionId, p_nota: texto(f, 'nota') });
  if (error) return { ok: false, mensaje: limpio(error.message) };
  revalidatePath(`/transbordo/${misionId}`);
  return { ok: true, mensaje: 'Listo: quedó registrado que recibió la carga de este camión.' };
}

export async function nuevaInvitacionOperador(asignacionId: string) {
  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.rpc('operador_nueva_invitacion', { p_asignacion: asignacionId });
  if (error) return { ok: false as const, mensaje: limpio(error.message) };
  const fila = (data as { codigo: string; vence_en: string }[])[0]!;
  return { ok: true as const, codigo: fila.codigo, venceEn: fila.vence_en };
}

export async function registrarDocumentoOperador(misionId: string, d: DatosDocumento) {
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc('operador_registrar_documento', {
    p_mision: misionId, p_tipo: d.tipo, p_ruta: d.ruta, p_nombre: d.nombre, p_asignacion: d.asignacionId,
    p_numero: d.numero, p_tipo_mime: d.tipoMime, p_tamano: d.tamano, p_reemplaza: d.reemplaza,
  });
  if (error) return { ok: false, mensaje: limpio(error.message) };
  revalidatePath(`/transbordo/${misionId}`);
  return { ok: true, mensaje: 'Documento guardado. Despacho ya puede verlo.' };
}
