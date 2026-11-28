'use server';
import { revalidatePath } from 'next/cache';
import type { Etapa } from '@reynales/shared';
import { crearClienteServidor } from '@/lib/supabase/server';
import { MENSAJE_TELEFONO, normalizarTelefono } from '@/lib/tipos';
import type { DatosDocumento } from '@/lib/documentos';

export interface Resultado {
  ok: boolean;
  mensaje: string;
  campo?: string;
  errorCampo?: string;
  /** Misión ya creada (aunque falle un paso posterior): la página sube los documentos y la abre. */
  misionId?: string;
  codigo?: string;
  /** Aviso que se resuelve marcando una casilla y volviendo a guardar. */
  aviso?: 'factura_repetida';
}

/** WhatsApp del coordinador en formato internacional; error junto al campo si no se puede. */
function telefonoCoordinador(f: FormData): { valor: string | null; error?: Resultado } {
  const v = texto(f, 'telefono_coordinador');
  if (!v) return { valor: null };
  const normal = normalizarTelefono(v);
  if (!normal) {
    return {
      valor: null,
      error: { ok: false, mensaje: `Revise el WhatsApp del coordinador: «${v}» no tiene código de país.`, campo: 'telefono_coordinador', errorCampo: MENSAJE_TELEFONO },
    };
  }
  return { valor: normal };
}

const texto = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
};
const numero = (f: FormData, k: string) => {
  const v = texto(f, k);
  return v === null ? null : Number(v.replace(',', '.'));
};

/** Datos del camión. En el tramo 1 el peso es de balanza; después de un transbordo, declarado. */
function datosAsignacion(f: FormData, tramo = 1) {
  return {
    transportista_id: texto(f, 'transportista_id'),
    conductor_id: texto(f, 'conductor_id'),
    vehiculo_id: texto(f, 'vehiculo_id'),
    tramo,
    toneladas_cargadas: tramo === 1 ? numero(f, 'toneladas_cargadas') : null,
    toneladas_declaradas: tramo > 1 ? numero(f, 'toneladas_declaradas') : null,
    ...(tramo > 1 ? { precinto: texto(f, 'precinto') } : {}),
  };
}

/**
 * Si el chofer o el camión ya están en otro viaje activo, devuelve un aviso
 * (salvo que despacho haya marcado «Asignar igual»).
 */
async function avisoOcupado(f: FormData): Promise<Resultado | null> {
  if (f.get('asignar_igual') === 'on') return null;
  const conductor = texto(f, 'conductor_id');
  const vehiculo = texto(f, 'vehiculo_id');
  if (!conductor || !vehiculo) return null;
  const supabase = await crearClienteServidor();
  const { data } = await supabase.rpc('viajes_activos_de', { p_conductor: conductor, p_vehiculo: vehiculo });
  const lista = (data ?? []) as { mision_codigo: string; placa: string; chofer: string; por_chofer: boolean; por_vehiculo: boolean }[];
  if (lista.length === 0) return null;
  const detalle = lista
    .map((v) => (v.por_chofer && v.por_vehiculo ? `${v.chofer} y ${v.placa}` : v.por_chofer ? `el chofer ${v.chofer}` : `el camión ${v.placa}`) + ` (misión ${v.mision_codigo})`)
    .join('; ');
  return {
    ok: false,
    mensaje: `Atención: ya está en un viaje activo ${detalle}. Si es correcto, marque «Asignar igual» y vuelva a guardar.`,
  };
}

/**
 * Aviso si la factura ya está en otra misión no cancelada (no bloquea: una factura puede
 * repartirse en dos misiones; se confirma con «Factura repetida: crear igual»).
 */
async function avisoFacturaRepetida(f: FormData): Promise<Resultado | null> {
  const factura = texto(f, 'factura');
  if (!factura || f.get('factura_igual') === 'on') return null;
  const supabase = await crearClienteServidor();
  const { data } = await supabase.from('misiones').select('codigo')
    .ilike('factura', factura.replace(/[%_\\]/g, (c) => `\\${c}`)).neq('etapa', 'cancelado').limit(3);
  const codigos = (data ?? []).map((m) => m.codigo as string);
  if (codigos.length === 0) return null;
  return {
    ok: false,
    aviso: 'factura_repetida',
    campo: 'factura',
    errorCampo: `Ya está en ${codigos.join(', ')}.`,
    mensaje: `La factura ${factura} ya está en la misión ${codigos.join(', ')}. Si es correcto (por ejemplo, una factura repartida en dos misiones), marque «Factura repetida: crear igual» y vuelva a guardar.`,
  };
}

// Obligatorios de una misión nueva, con el nombre que ve el usuario.
const OBLIGATORIOS_MISION: [string, string][] = [
  ['cliente_id', 'el cliente'], ['origen_id', 'el origen'], ['destino_id', 'el destino'],
  ['transportista_id', 'el transportista'], ['conductor_id', 'el chofer'], ['vehiculo_id', 'el vehículo'],
];

export async function crearMision(_: Resultado | null, f: FormData): Promise<Resultado> {
  const falta = OBLIGATORIOS_MISION.find(([campo]) => !texto(f, campo));
  if (falta) return { ok: false, mensaje: `Falta elegir ${falta[1]}.`, campo: falta[0], errorCampo: 'Dato obligatorio.' };
  const conTransbordo = f.get('con_transbordo') === 'on';
  if (conTransbordo && !texto(f, 'transportista_tramo2')) {
    return { ok: false, mensaje: 'Falta elegir la empresa que hará el tramo después del transbordo.', campo: 'transportista_tramo2', errorCampo: 'Dato obligatorio.' };
  }
  const coordinador = telefonoCoordinador(f);
  if (coordinador.error) return coordinador.error;
  const ocupado = await avisoOcupado(f);
  if (ocupado) return ocupado;
  const repetida = await avisoFacturaRepetida(f);
  if (repetida) return repetida;
  const supabase = await crearClienteServidor();
  const { data: mision, error } = await supabase
    .from('misiones')
    .insert({
      cliente_id: texto(f, 'cliente_id'),
      origen_id: texto(f, 'origen_id'),
      destino_id: texto(f, 'destino_id'),
      factura: texto(f, 'factura'),
      guia: texto(f, 'guia'),
      dex: texto(f, 'dex'),
      tipo_carga: texto(f, 'tipo_carga'),
      tonelaje_objetivo: numero(f, 'tonelaje_objetivo'),
      telefono_coordinador: coordinador.valor,
      notas: texto(f, 'notas'),
    })
    .select('id, codigo')
    .single();
  if (error || !mision) return { ok: false, mensaje: `No se pudo crear la misión: ${error?.message}` };
  const creada = { misionId: mision.id as string, codigo: mision.codigo as string };

  if (conTransbordo) {
    const { error: errorTramo } = await supabase.from('tramos').insert({
      mision_id: mision.id, numero: 2, transportista_id: texto(f, 'transportista_tramo2'), lugar_inicio: texto(f, 'lugar_tramo2'),
    });
    if (errorTramo) {
      return { ok: false, ...creada, mensaje: `La misión ${creada.codigo} se creó, pero no el transbordo: ${errorTramo.message}. Agréguelo desde el detalle.` };
    }
  }

  const { error: errorAsig } = await supabase.from('asignaciones').insert({ mision_id: mision.id, ...datosAsignacion(f) });
  if (errorAsig) {
    return { ok: false, ...creada, mensaje: `La misión ${creada.codigo} se creó, pero no el camión: ${errorAsig.message}. Agréguelo desde el detalle.` };
  }
  revalidatePath('/misiones');
  return { ok: true, ...creada, mensaje: `Misión ${creada.codigo} creada.` };
}

export async function editarMision(misionId: string, _: Resultado | null, f: FormData): Promise<Resultado> {
  const supabase = await crearClienteServidor();
  const tonelaje = numero(f, 'tonelaje_objetivo');
  if (tonelaje !== null && (Number.isNaN(tonelaje) || tonelaje < 0)) return { ok: false, mensaje: 'El tonelaje debe ser un número.' };
  const coordinador = telefonoCoordinador(f);
  if (coordinador.error) return coordinador.error;
  const { error } = await supabase
    .from('misiones')
    .update({
      factura: texto(f, 'factura'),
      guia: texto(f, 'guia'),
      dex: texto(f, 'dex'),
      tipo_carga: texto(f, 'tipo_carga'),
      tonelaje_objetivo: tonelaje,
      telefono_coordinador: coordinador.valor,
      notas: texto(f, 'notas'),
    })
    .eq('id', misionId);
  if (error) return { ok: false, mensaje: `No se pudo guardar: ${error.message}` };
  revalidatePath(`/misiones/${misionId}`);
  return { ok: true, mensaje: 'Datos de la misión actualizados.' };
}

export async function agregarCamion(misionId: string, tramo: number, _: Resultado | null, f: FormData): Promise<Resultado> {
  const declaradas = numero(f, 'toneladas_declaradas');
  if (tramo > 1 && declaradas !== null && (Number.isNaN(declaradas) || declaradas < 0)) {
    return { ok: false, mensaje: 'Las toneladas deben ser un número.', campo: 'toneladas_declaradas', errorCampo: 'Escriba un número, por ejemplo 14,5.' };
  }
  if (tramo > 1 && !texto(f, 'precinto')) {
    return { ok: false, mensaje: 'Escriba el número de precinto del camión.', campo: 'precinto', errorCampo: 'Dato obligatorio.' };
  }
  const ocupado = await avisoOcupado(f);
  if (ocupado) return ocupado;
  const supabase = await crearClienteServidor();
  const { error } = await supabase.from('asignaciones').insert({ mision_id: misionId, ...datosAsignacion(f, tramo) });
  if (error) return { ok: false, mensaje: `No se pudo agregar el camión: ${error.message}` };
  revalidatePath(`/misiones/${misionId}`);
  return { ok: true, mensaje: 'Camión agregado. Genere ahora la invitación para el chofer.' };
}

/** Agrega un transbordo: el tramo siguiente, con la empresa que lo hará y el lugar aproximado. */
export async function agregarTransbordo(misionId: string, numeroTramo: number, _: Resultado | null, f: FormData): Promise<Resultado> {
  const transportista = texto(f, 'transportista_tramo');
  if (!transportista) return { ok: false, mensaje: 'Falta elegir la empresa del nuevo tramo.', campo: 'transportista_tramo', errorCampo: 'Dato obligatorio.' };
  const supabase = await crearClienteServidor();
  const { error } = await supabase.from('tramos').insert({
    mision_id: misionId, numero: numeroTramo, transportista_id: transportista, lugar_inicio: texto(f, 'lugar_tramo'),
  });
  if (error) return { ok: false, mensaje: error.message };
  revalidatePath(`/misiones/${misionId}`);
  return { ok: true, mensaje: `Transbordo registrado. Agregue los camiones del tramo ${numeroTramo} cuando los conozca.` };
}

/** Corrige el lugar de transbordo o la empresa de un tramo. */
export async function editarTramo(misionId: string, tramoId: string, _: Resultado | null, f: FormData): Promise<Resultado> {
  const supabase = await crearClienteServidor();
  const { error } = await supabase.from('tramos')
    .update({ transportista_id: texto(f, 'transportista_tramo'), lugar_inicio: texto(f, 'lugar_tramo') })
    .eq('id', tramoId);
  if (error) return { ok: false, mensaje: error.message };
  revalidatePath(`/misiones/${misionId}`);
  return { ok: true, mensaje: 'Tramo actualizado.' };
}

/** Toneladas declaradas de un camión después del transbordo (no puede superar lo pesado en fábrica + 0,5 %). */
export async function fijarToneladasDeclaradas(asignacionId: string, misionId: string, _: Resultado | null, f: FormData): Promise<Resultado> {
  const valor = numero(f, 'toneladas_declaradas');
  if (valor !== null && (Number.isNaN(valor) || valor < 0)) {
    return { ok: false, mensaje: 'Escriba un número, por ejemplo 14,5.', campo: 'toneladas_declaradas', errorCampo: 'Número no válido.' };
  }
  const supabase = await crearClienteServidor();
  const { error } = await supabase.from('asignaciones').update({ toneladas_declaradas: valor }).eq('id', asignacionId);
  if (error) return { ok: false, mensaje: error.message };
  revalidatePath(`/misiones/${misionId}`);
  return { ok: true, mensaje: 'Toneladas guardadas.' };
}

export async function crearInvitacion(asignacionId: string) {
  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.rpc('crear_invitacion', { p_asignacion: asignacionId, p_horas: 72 });
  if (error) return { ok: false as const, mensaje: error.message };
  const fila = (data as { codigo: string; vence_en: string }[])[0]!;
  return { ok: true as const, codigo: fila.codigo, venceEn: fila.vence_en };
}

export async function atenderEmergencia(asignacionId: string, misionId: string, _: Resultado | null, f: FormData): Promise<Resultado> {
  const nota = texto(f, 'nota');
  if (!nota) return { ok: false, mensaje: 'Escriba qué se hizo (ej. "se llamó al chofer, está bien, se envió mecánico").' };
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc('atender_emergencia', { p_asignacion: asignacionId, p_nota: nota });
  if (error) return { ok: false, mensaje: error.message };
  revalidatePath(`/misiones/${misionId}`);
  return { ok: true, mensaje: 'Emergencia marcada como atendida.' };
}

export async function cambiarEtapaManual(asignacionId: string, misionId: string, _: Resultado | null, f: FormData): Promise<Resultado> {
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc('cambiar_etapa_manual', {
    p_asignacion: asignacionId,
    p_etapa: texto(f, 'etapa') as Etapa,
    p_nota: texto(f, 'nota'),
  });
  if (error) return { ok: false, mensaje: error.message };
  revalidatePath(`/misiones/${misionId}`);
  return { ok: true, mensaje: 'Etapa actualizada (modo manual).' };
}

/** Minutos sin moverse para avisar «Detenido» (todos los usuarios del panel). */
export async function fijarMinutosDetenido(_: Resultado | null, f: FormData): Promise<Resultado> {
  const minutos = numero(f, 'minutos');
  if (minutos === null || !Number.isInteger(minutos) || minutos < 10 || minutos > 720) {
    return { ok: false, mensaje: 'Escriba un número entero de minutos entre 10 y 720.', campo: 'minutos', errorCampo: 'Entre 10 y 720 minutos.' };
  }
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc('fijar_minutos_detenido', { p_minutos: minutos });
  if (error) return { ok: false, mensaje: error.message };
  revalidatePath('/');
  return { ok: true, mensaje: `Listo: se avisará «Detenido» a los ${minutos} minutos sin moverse.` };
}

/** Crea (o reemplaza) el enlace de seguimiento que se envía al cliente. */
export async function crearEnlaceSeguimiento(misionId: string) {
  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.rpc('crear_enlace_seguimiento', { p_mision: misionId });
  if (error || typeof data !== 'string') return { ok: false as const, mensaje: error?.message ?? 'No se pudo crear el enlace.' };
  revalidatePath(`/misiones/${misionId}`);
  return { ok: true as const, token: data };
}

/** Anula el enlace del cliente: deja de funcionar de inmediato. */
export async function anularEnlaceSeguimiento(misionId: string) {
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc('anular_enlace_seguimiento', { p_mision: misionId });
  if (error) return { ok: false as const, mensaje: error.message };
  revalidatePath(`/misiones/${misionId}`);
  return { ok: true as const };
}

/** Despacho registra un documento ya subido al almacenamiento (y, si corresponde, reemplaza la versión anterior). */
export async function registrarDocumentoDespacho(misionId: string, d: DatosDocumento) {
  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.from('documentos').insert({
    mision_id: misionId, asignacion_id: d.asignacionId, tipo: d.tipo, etiqueta: d.etiqueta ?? null, numero: d.numero, ruta_archivo: d.ruta,
    nombre_original: d.nombre.slice(0, 200), tipo_mime: d.tipoMime, tamano_bytes: d.tamano,
  }).select('id').single();
  if (error || !data) return { ok: false, mensaje: `No se pudo guardar el documento: ${error?.message}` };
  if (d.reemplaza) {
    const { error: errorReemplazo } = await supabase.rpc('reemplazar_documento', { p_anterior: d.reemplaza, p_nuevo: data.id });
    if (errorReemplazo) return { ok: false, mensaje: `Se guardó el documento, pero no se marcó el reemplazo: ${errorReemplazo.message}` };
  }
  revalidatePath(`/misiones/${misionId}`);
  return { ok: true, mensaje: 'Documento guardado.' };
}
