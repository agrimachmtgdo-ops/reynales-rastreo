'use server';
import { revalidatePath } from 'next/cache';
import { crearClienteServidor } from '@/lib/supabase/server';
import type { ResultadoFormulario as Resultado } from '@/componentes/errorCampo';

const texto = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
};
/** Número opcional: null si está vacío, NaN si no es un número. */
const numero = (f: FormData, k: string) => {
  const v = texto(f, k);
  return v === null ? null : Number(v.replace(',', '.'));
};
/** «2026-12-07T07:30» (hora de Bolivia) → marca de tiempo; undefined si el formato no es válido. */
const fechaHora = (f: FormData, k: string): string | null | undefined => {
  const v = texto(f, k);
  if (!v) return null;
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? `${v}:00-04:00` : undefined;
};

function refrescar(envio: string, pedido?: string) {
  revalidatePath('/programa');
  revalidatePath(`/programa/${envio}`);
  if (pedido) revalidatePath(`/pedidos/${pedido}`);
}

function mensajeAmable(m: string): string {
  if (m.includes('Could not find the function')) return 'Falta aplicar la migración del requerimiento de camiones en Supabase.';
  if (m.includes('misiones_envio_vivo')) return 'El envío ya tiene una misión activa.';
  return m;
}

/** Camiones necesarios y hora de presentación en fábrica del envío. */
export async function guardarRequerimiento(envio: string, _: Resultado | null, f: FormData): Promise<Resultado> {
  const camiones = numero(f, 'camiones');
  const presentacion = fechaHora(f, 'presentacion');
  if (camiones !== null && (!Number.isInteger(camiones) || camiones < 1 || camiones > 60)) {
    return { ok: false, mensaje: 'Los camiones necesarios deben ser un número entero entre 1 y 60.', campo: 'camiones', errorCampo: 'Entre 1 y 60.' };
  }
  if (presentacion === undefined) return { ok: false, mensaje: 'Revise la hora de presentación.', campo: 'presentacion', errorCampo: 'Fecha y hora no válidas.' };
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc('guardar_requerimiento', { p_envio: envio, p_camiones: camiones, p_presentacion: presentacion });
  if (error) return { ok: false, mensaje: mensajeAmable(error.message) };
  refrescar(envio);
  return { ok: true, mensaje: 'Requerimiento guardado.' };
}

/** Pide camiones a un transportista (una línea por transportista). */
export async function pedirCamiones(envio: string, _: Resultado | null, f: FormData): Promise<Resultado> {
  const transportista = texto(f, 'transportista_id');
  const camiones = numero(f, 'camiones');
  const presentacion = fechaHora(f, 'presentacion');
  const tarifa = numero(f, 'tarifa');
  if (!transportista) return { ok: false, mensaje: 'Elija el transportista.', campo: 'transportista_id', errorCampo: 'Dato obligatorio.' };
  if (camiones === null || !Number.isInteger(camiones) || camiones < 1 || camiones > 60) {
    return { ok: false, mensaje: 'Escriba cuántos camiones pide (entero entre 1 y 60).', campo: 'camiones', errorCampo: 'Entre 1 y 60.' };
  }
  if (presentacion === undefined) return { ok: false, mensaje: 'Revise la hora de presentación.', campo: 'presentacion', errorCampo: 'Fecha y hora no válidas.' };
  if (tarifa !== null && (!Number.isFinite(tarifa) || tarifa < 0)) {
    return { ok: false, mensaje: 'La tarifa debe ser un número (0 o más).', campo: 'tarifa', errorCampo: 'Número no válido.' };
  }
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc('pedir_camiones', {
    p_envio: envio, p_transportista: transportista, p_camiones: camiones, p_presentacion: presentacion,
    p_tarifa: tarifa, p_tarifa_tipo: texto(f, 'tarifa_tipo') ?? 'viaje', p_moneda: texto(f, 'moneda') ?? 'BOB', p_nota: texto(f, 'nota'),
  });
  if (error) return { ok: false, mensaje: mensajeAmable(error.message) };
  refrescar(envio);
  return { ok: true, mensaje: 'Pedido registrado. Copie el mensaje de WhatsApp de esa línea y envíelo al transportista.' };
}

/** Respuesta del transportista: cuántos camiones confirma (0 = rechaza) y, si cambió, la tarifa. */
export async function responderSolicitud(solicitud: string, envio: string, _: Resultado | null, f: FormData): Promise<Resultado> {
  const confirmados = numero(f, 'confirmados');
  const tarifa = numero(f, 'tarifa');
  if (confirmados === null || !Number.isInteger(confirmados) || confirmados < 0) {
    return { ok: false, mensaje: 'Escriba cuántos camiones confirmó (0 si no puede).', campo: 'confirmados', errorCampo: 'Número entero, 0 o más.' };
  }
  if (tarifa !== null && (!Number.isFinite(tarifa) || tarifa < 0)) {
    return { ok: false, mensaje: 'La tarifa debe ser un número (0 o más).', campo: 'tarifa', errorCampo: 'Número no válido.' };
  }
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc('responder_solicitud', { p_solicitud: solicitud, p_confirmados: confirmados, p_tarifa: tarifa, p_nota: texto(f, 'nota') });
  if (error) return { ok: false, mensaje: mensajeAmable(error.message) };
  refrescar(envio);
  return { ok: true, mensaje: confirmados === 0 ? 'Registrado: el transportista no puede. Pida a otro.' : 'Respuesta registrada. Ahora cargue placas y choferes.' };
}

export async function anularSolicitud(solicitud: string, envio: string, _: Resultado | null): Promise<Resultado> {
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc('anular_solicitud', { p_solicitud: solicitud });
  if (error) return { ok: false, mensaje: mensajeAmable(error.message) };
  refrescar(envio);
  return { ok: true, mensaje: 'Pedido de camiones anulado.' };
}

/** Crea la misión del envío (una por envío): de ahí salen el seguimiento y los documentos. */
export async function crearMisionEnvio(envio: string, pedido: string, _: Resultado | null, f: FormData): Promise<Resultado> {
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc('crear_mision_envio', { p_envio: envio, p_origen: texto(f, 'origen_id') });
  if (error) return { ok: false, mensaje: mensajeAmable(error.message), campo: error.message.includes('fábrica') ? 'origen_id' : undefined };
  refrescar(envio, pedido);
  revalidatePath('/misiones');
  return { ok: true, mensaje: 'Misión creada. Cargue los camiones que confirmaron los transportistas.' };
}

/** Carga un camión (placa y chofer) del transportista de la solicitud; avisa si ya está en otro viaje. */
export async function agregarCamion(solicitud: string, envio: string, _: Resultado | null, f: FormData): Promise<Resultado> {
  const conductor = texto(f, 'conductor_id');
  const vehiculo = texto(f, 'vehiculo_id');
  if (!vehiculo) return { ok: false, mensaje: 'Elija el camión (placa).', campo: 'vehiculo_id', errorCampo: 'Dato obligatorio.' };
  if (!conductor) return { ok: false, mensaje: 'Elija el chofer.', campo: 'conductor_id', errorCampo: 'Dato obligatorio.' };
  const supabase = await crearClienteServidor();
  if (f.get('asignar_igual') !== 'on') {
    const { data } = await supabase.rpc('viajes_activos_de', { p_conductor: conductor, p_vehiculo: vehiculo });
    const lista = (data ?? []) as { mision_codigo: string; placa: string; chofer: string; por_chofer: boolean; por_vehiculo: boolean }[];
    if (lista.length > 0) {
      const detalle = lista
        .map((v) => (v.por_chofer && v.por_vehiculo ? `${v.chofer} y ${v.placa}` : v.por_chofer ? `el chofer ${v.chofer}` : `el camión ${v.placa}`) + ` (misión ${v.mision_codigo})`)
        .join('; ');
      return { ok: false, mensaje: `Atención: ya está en un viaje activo ${detalle}. Si es correcto, marque «Asignar igual» y vuelva a guardar.` };
    }
  }
  const { error } = await supabase.rpc('agregar_camion_solicitud', { p_solicitud: solicitud, p_conductor: conductor, p_vehiculo: vehiculo });
  if (error) return { ok: false, mensaje: mensajeAmable(error.message) };
  refrescar(envio);
  revalidatePath('/misiones');
  return { ok: true, mensaje: 'Camión cargado en la misión. Envíe al chofer la invitación desde la misión.' };
}

export async function registrarLlegada(asignacion: string, envio: string, _: Resultado | null): Promise<Resultado> {
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc('registrar_llegada', { p_asignacion: asignacion, p_momento: new Date().toISOString() });
  if (error) return { ok: false, mensaje: mensajeAmable(error.message) };
  refrescar(envio);
  return { ok: true, mensaje: 'Llegada a fábrica registrada.' };
}

export async function registrarAusencia(asignacion: string, envio: string, _: Resultado | null, f: FormData): Promise<Resultado> {
  const causa = texto(f, 'causa');
  if (!causa) return { ok: false, mensaje: 'Escriba la causa.', campo: 'causa', errorCampo: 'Dato obligatorio.' };
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc('registrar_ausencia', { p_asignacion: asignacion, p_causa: causa });
  if (error) return { ok: false, mensaje: mensajeAmable(error.message) };
  refrescar(envio);
  return { ok: true, mensaje: 'Registrado: el camión no se presentó. Puede cargar un reemplazo en la misma línea.' };
}

export async function registrarEmbarque(envio: string, _: Resultado | null, f: FormData): Promise<Resultado> {
  const fecha = texto(f, 'embarque');
  if (fecha && !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return { ok: false, mensaje: 'Revise la fecha.', campo: 'embarque', errorCampo: 'Fecha no válida.' };
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc('registrar_embarque', { p_envio: envio, p_fecha: fecha });
  if (error) return { ok: false, mensaje: mensajeAmable(error.message) };
  refrescar(envio);
  return { ok: true, mensaje: fecha ? 'Fecha de embarque registrada.' : 'Fecha de embarque borrada.' };
}

/** Días de anticipación para pedir camiones (solo el administrador). */
export async function fijarDiasAnticipacion(_: Resultado | null, f: FormData): Promise<Resultado> {
  const dias = numero(f, 'dias');
  if (dias === null || !Number.isInteger(dias) || dias < 1 || dias > 30) {
    return { ok: false, mensaje: 'Escriba un número entero de días entre 1 y 30.', campo: 'dias', errorCampo: 'Entre 1 y 30.' };
  }
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc('fijar_dias_anticipacion', { p_dias: dias });
  if (error) return { ok: false, mensaje: mensajeAmable(error.message) };
  revalidatePath('/programa');
  return { ok: true, mensaje: `Listo: se avisará con ${dias} días de anticipación.` };
}

/** Peso de balanza (tramo 1) de un camión del envío. */
export async function registrarPeso(asignacion: string, envio: string, _: Resultado | null, f: FormData): Promise<Resultado> {
  const peso = numero(f, 'peso');
  if (peso === null || Number.isNaN(peso) || peso <= 0 || peso > 60) {
    return { ok: false, mensaje: 'Escriba el peso en toneladas, por ejemplo 29,4.', campo: 'peso', errorCampo: 'Entre 0 y 60 t.' };
  }
  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.from('asignaciones').update({ toneladas_cargadas: peso }).eq('id', asignacion).eq('tramo', 1).select('mision_id');
  if (error) return { ok: false, mensaje: mensajeAmable(error.message) };
  if (!data?.length) return { ok: false, mensaje: 'No se pudo guardar el peso (sin permiso o camión no encontrado).' };
  refrescar(envio);
  if (data[0]?.mision_id) revalidatePath(`/misiones/${data[0].mision_id}`);
  return { ok: true, mensaje: 'Peso guardado.' };
}
