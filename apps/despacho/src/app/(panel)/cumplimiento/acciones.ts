'use server';
import { revalidatePath } from 'next/cache';
import { crearClienteServidor } from '@/lib/supabase/server';
import type { ResultadoFormulario as Resultado } from '@/componentes/errorCampo';

const numero = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === 'string' && v.trim() !== '' ? Number(v.trim().replace(',', '.')) : NaN;
};

/** Tolerancias y meta del cumplimiento (solo el administrador). */
export async function fijarAjustesCumplimiento(_: Resultado | null, f: FormData): Promise<Resultado> {
  const dias = numero(f, 'dias');
  const pct = numero(f, 'pct');
  const meta = numero(f, 'meta');
  const min = numero(f, 'min');
  if (!Number.isInteger(dias) || dias < 0 || dias > 10) return { ok: false, mensaje: 'Días de tolerancia: entero entre 0 y 10.', campo: 'dias', errorCampo: 'Entre 0 y 10.' };
  if (!Number.isFinite(pct) || pct < 0 || pct > 20) return { ok: false, mensaje: 'Tolerancia de toneladas: entre 0 y 20 %.', campo: 'pct', errorCampo: 'Entre 0 y 20.' };
  if (!Number.isFinite(meta) || meta < 50 || meta > 100) return { ok: false, mensaje: 'Meta de OTIF: entre 50 y 100 %.', campo: 'meta', errorCampo: 'Entre 50 y 100.' };
  if (!Number.isInteger(min) || min < 0 || min > 600) return { ok: false, mensaje: 'Tolerancia de llegada: entero entre 0 y 600 minutos.', campo: 'min', errorCampo: 'Entre 0 y 600.' };
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc('fijar_ajustes_cumplimiento', {
    p_tolerancia_dias: dias, p_tolerancia_pct: pct, p_meta_pct: meta, p_tolerancia_min: min,
  });
  if (error) return { ok: false, mensaje: error.message };
  revalidatePath('/cumplimiento');
  return { ok: true, mensaje: 'Ajustes guardados.' };
}
