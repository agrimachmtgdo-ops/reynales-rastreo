'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { Etapa } from '@reynales/shared';
import { crearClienteServidor } from '@/lib/supabase/server';
import { MENSAJE_TELEFONO, normalizarTelefono } from '@/lib/tipos';

export interface Resultado {
  ok: boolean;
  mensaje: string;
  campo?: string;
  errorCampo?: string;
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

function datosAsignacion(f: FormData) {
  return {
    transportista_id: texto(f, 'transportista_id'),
    conductor_id: texto(f, 'conductor_id'),
    vehiculo_id: texto(f, 'vehiculo_id'),
    toneladas_cargadas: numero(f, 'toneladas_cargadas'),
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

/** Crea la misión con su primer camión y abre el detalle. */
export async function crearMision(_: Resultado | null, f: FormData): Promise<Resultado> {
  const coordinador = telefonoCoordinador(f);
  if (coordinador.error) return coordinador.error;
  const ocupado = await avisoOcupado(f);
  if (ocupado) return ocupado;
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
    .select('id')
    .single();
  if (error || !mision) return { ok: false, mensaje: `No se pudo crear la misión: ${error?.message}` };

  const { error: errorAsig } = await supabase.from('asignaciones').insert({ mision_id: mision.id, ...datosAsignacion(f) });
  if (errorAsig) {
    return { ok: false, mensaje: `La misión se creó, pero no el camión: ${errorAsig.message}. Agréguelo desde el detalle.` };
  }
  revalidatePath('/misiones');
  redirect(`/misiones/${mision.id}`);
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

export async function agregarCamion(misionId: string, _: Resultado | null, f: FormData): Promise<Resultado> {
  const ocupado = await avisoOcupado(f);
  if (ocupado) return ocupado;
  const supabase = await crearClienteServidor();
  const { error } = await supabase.from('asignaciones').insert({ mision_id: misionId, ...datosAsignacion(f) });
  if (error) return { ok: false, mensaje: `No se pudo agregar el camión: ${error.message}` };
  revalidatePath(`/misiones/${misionId}`);
  return { ok: true, mensaje: 'Camión agregado. Genere ahora la invitación para el chofer.' };
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
