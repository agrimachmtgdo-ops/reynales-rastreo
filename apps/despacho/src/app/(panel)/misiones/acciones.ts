'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { Etapa } from '@reynales/shared';
import { crearClienteServidor } from '@/lib/supabase/server';

export interface Resultado {
  ok: boolean;
  mensaje: string;
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

/** Crea la misión con su primer camión y abre el detalle. */
export async function crearMision(_: Resultado | null, f: FormData): Promise<Resultado> {
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
      telefono_coordinador: texto(f, 'telefono_coordinador'),
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

export async function agregarCamion(misionId: string, _: Resultado | null, f: FormData): Promise<Resultado> {
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
