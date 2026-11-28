'use server';
import { revalidatePath } from 'next/cache';
import { crearClienteServidor } from '@/lib/supabase/server';
import { CAUSAS } from '@/lib/pedidos';
import type { ResultadoFormulario as Resultado } from '@/componentes/errorCampo';

const texto = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
};
const esCausa = (c: string | null): c is string => !!c && CAUSAS.some((x) => x.id === c);
const esFecha = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

export interface DatosPedido {
  cliente_id: string;
  orden_compra: string | null;
  producto: string;
  toneladas: number;
  entrega_desde: string | null;
  entrega_hasta: string;
  destino_id: string;
  incoterm: string;
  notas: string | null;
  origen?: 'manual' | 'excel';
}
export interface EnvioNuevo { toneladas: number; entrega: string; carga: string | null }
export type ResultadoGuardar = { ok: true; id: string } | { ok: false; mensaje: string };

/** Crea (id = null) o cambia un pedido en borrador: lo que pidió el cliente, sin el programa. */
export async function guardarPedido(id: string | null, datos: DatosPedido): Promise<ResultadoGuardar> {
  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.rpc('guardar_pedido', { p_pedido: id, p_datos: datos });
  if (error) return { ok: false, mensaje: mensajeAmable(error.message) };
  revalidatePath('/pedidos');
  return { ok: true, id: data as string };
}

/** Guarda los envíos planificados del pedido (los confirmados no cambian aquí). */
export async function guardarPrograma(pedido: string, envios: EnvioNuevo[]): Promise<{ ok: boolean; mensaje: string }> {
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc('guardar_programa', { p_pedido: pedido, p_envios: envios });
  if (error) return { ok: false, mensaje: mensajeAmable(error.message) };
  revalidatePath(`/pedidos/${pedido}`);
  revalidatePath('/pedidos');
  return { ok: true, mensaje: envios.length ? 'Programa guardado como planificado.' : 'Se quitaron los envíos planificados.' };
}

/** Confirma los envíos planificados: sus fechas pasan a ser el compromiso con el cliente. */
export async function confirmarPrograma(pedido: string, _: Resultado | null): Promise<Resultado> {
  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.rpc('confirmar_programa', { p_pedido: pedido });
  if (error) return { ok: false, mensaje: mensajeAmable(error.message) };
  revalidatePath(`/pedidos/${pedido}`);
  revalidatePath('/pedidos');
  const n = Number(data);
  return { ok: true, mensaje: `Programa confirmado: ${n} ${n === 1 ? 'envío queda' : 'envíos quedan'} como compromiso con el cliente.` };
}

/** Importación desde Excel: crea cada pedido con su programa planificado y devuelve el resultado de cada uno. */
export async function importarPedidos(lista: { clave: string; datos: DatosPedido; envios: EnvioNuevo[] }[]) {
  const supabase = await crearClienteServidor();
  const resultados: { clave: string; ok: boolean; mensaje: string; id?: string }[] = [];
  for (const p of lista) {
    const { data, error } = await supabase.rpc('crear_pedido_con_programa', {
      p_datos: { ...p.datos, origen: 'excel' }, p_envios: p.envios,
    });
    resultados.push(error
      ? { clave: p.clave, ok: false, mensaje: mensajeAmable(error.message) }
      : { clave: p.clave, ok: true, mensaje: 'Creado en borrador', id: data as string });
  }
  revalidatePath('/pedidos');
  return resultados;
}

/** Confirma el pedido: las fechas de entrega pasan a ser el compromiso con el cliente. */
export async function confirmarPedido(id: string, _: Resultado | null): Promise<Resultado> {
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc('confirmar_pedido', { p_pedido: id });
  if (error) return { ok: false, mensaje: mensajeAmable(error.message) };
  revalidatePath(`/pedidos/${id}`);
  revalidatePath('/pedidos');
  return { ok: true, mensaje: 'Pedido confirmado: la orden del cliente queda aceptada. Ahora arme y confirme el programa de envíos.' };
}

/** Cambia la fecha (y si hace falta las toneladas) de un envío, con la causa obligatoria. */
export async function reprogramarEnvio(envio: string, pedido: string, _: Resultado | null, f: FormData): Promise<Resultado> {
  const fecha = texto(f, 'fecha');
  const toneladas = Number(String(f.get('toneladas') ?? '').replace(',', '.'));
  const causa = texto(f, 'causa');
  const nota = texto(f, 'nota');
  if (!esFecha(fecha)) return { ok: false, mensaje: 'Elija la nueva fecha de entrega.', campo: 'fecha', errorCampo: 'Dato obligatorio.' };
  if (!Number.isFinite(toneladas) || toneladas <= 0) {
    return { ok: false, mensaje: 'Las toneladas deben ser un número mayor que 0.', campo: 'toneladas', errorCampo: 'Número mayor que 0.' };
  }
  if (!esCausa(causa)) return { ok: false, mensaje: 'Elija la causa del cambio.', campo: 'causa', errorCampo: 'Dato obligatorio.' };
  if (causa === 'otra' && !nota) return { ok: false, mensaje: 'Explique la causa en la nota.', campo: 'nota', errorCampo: 'Explique la causa.' };
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc('reprogramar_envio', { p_envio: envio, p_fecha: fecha, p_toneladas: toneladas, p_causa: causa, p_nota: nota });
  if (error) return { ok: false, mensaje: mensajeAmable(error.message) };
  revalidatePath(`/pedidos/${pedido}`);
  revalidatePath('/pedidos');
  return {
    ok: true,
    mensaje: causa === 'cliente'
      ? 'Envío reprogramado a pedido del cliente: la fecha comprometida también cambió.'
      : 'Envío reprogramado. La fecha comprometida con el cliente no cambia, así que el cumplimiento se mide contra ella.',
  };
}

/** Corrige la fecha de carga en fábrica de un envío confirmado (no mueve el compromiso). */
export async function cambiarFechaCarga(envio: string, pedido: string, _: Resultado | null, f: FormData): Promise<Resultado> {
  const fecha = texto(f, 'carga');
  const causa = texto(f, 'causa');
  const nota = texto(f, 'nota');
  if (!esFecha(fecha)) return { ok: false, mensaje: 'Elija la nueva fecha de carga.', campo: 'carga', errorCampo: 'Dato obligatorio.' };
  if (!esCausa(causa)) return { ok: false, mensaje: 'Elija la causa del cambio.', campo: 'causa', errorCampo: 'Dato obligatorio.' };
  if (causa === 'otra' && !nota) return { ok: false, mensaje: 'Explique la causa en la nota.', campo: 'nota', errorCampo: 'Explique la causa.' };
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc('cambiar_fecha_carga', { p_envio: envio, p_fecha: fecha, p_causa: causa, p_nota: nota });
  if (error) {
    return { ok: false, mensaje: error.message.includes('Could not find the function') ? 'Falta aplicar la migración de la fecha de carga en Supabase.' : error.message };
  }
  revalidatePath(`/pedidos/${pedido}`);
  revalidatePath('/programa');
  return { ok: true, mensaje: 'Fecha de carga corregida. El compromiso con el cliente no cambia.' };
}

/** Cancela un envío del programa, con la causa obligatoria. */
export async function cancelarEnvio(envio: string, pedido: string, _: Resultado | null, f: FormData): Promise<Resultado> {
  const causa = texto(f, 'causa');
  const nota = texto(f, 'nota');
  if (!esCausa(causa)) return { ok: false, mensaje: 'Elija la causa de la cancelación.', campo: 'causa', errorCampo: 'Dato obligatorio.' };
  if (causa === 'otra' && !nota) return { ok: false, mensaje: 'Explique la causa en la nota.', campo: 'nota', errorCampo: 'Explique la causa.' };
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc('cancelar_envio', { p_envio: envio, p_causa: causa, p_nota: nota });
  if (error) return { ok: false, mensaje: mensajeAmable(error.message) };
  revalidatePath(`/pedidos/${pedido}`);
  revalidatePath('/pedidos');
  return { ok: true, mensaje: 'Envío cancelado.' };
}

/** Cancela el pedido completo (y sus envíos pendientes). */
export async function cancelarPedido(id: string, _: Resultado | null, f: FormData): Promise<Resultado> {
  const motivo = texto(f, 'motivo');
  if (!motivo) return { ok: false, mensaje: 'Escriba el motivo de la cancelación.', campo: 'motivo', errorCampo: 'Dato obligatorio.' };
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc('cancelar_pedido', { p_pedido: id, p_motivo: motivo });
  if (error) return { ok: false, mensaje: mensajeAmable(error.message) };
  revalidatePath(`/pedidos/${id}`);
  revalidatePath('/pedidos');
  return { ok: true, mensaje: 'Pedido cancelado.' };
}

/** Traduce los errores técnicos más comunes a un mensaje que el usuario entiende. */
function mensajeAmable(m: string): string {
  if (m.includes('pedidos_oc_unica')) return 'Ya existe un pedido de este cliente con esa orden de compra.';
  if (m.includes('Could not find the function')) return 'Falta aplicar la migración de pedidos en Supabase.';
  return m;
}
