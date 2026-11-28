'use server';
import { revalidatePath } from 'next/cache';
import { crearClienteServidor } from '@/lib/supabase/server';
import { esPerfil, nombrePerfil } from '@/lib/perfiles';
import type { ResultadoFormulario as Resultado } from '@/componentes/errorCampo';

const texto = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
};

/** ADMINISTRADOR: convierte una cuenta creada en Supabase en personal activo con su perfil. */
export async function registrarPersonal(_: Resultado | null, f: FormData): Promise<Resultado> {
  const correo = texto(f, 'correo');
  const nombre = texto(f, 'nombre');
  const perfil = texto(f, 'perfil');
  if (!correo) return { ok: false, mensaje: 'Escriba el correo de la cuenta.', campo: 'correo', errorCampo: 'Dato obligatorio.' };
  if (!nombre) return { ok: false, mensaje: 'Escriba el nombre.', campo: 'nombre', errorCampo: 'Dato obligatorio.' };
  if (!esPerfil(perfil)) return { ok: false, mensaje: 'Elija el perfil.', campo: 'perfil', errorCampo: 'Dato obligatorio.' };
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc('registrar_personal', { p_correo: correo, p_nombre: nombre, p_perfil: perfil });
  if (error) return { ok: false, mensaje: error.message };
  revalidatePath('/usuarios');
  return { ok: true, mensaje: `Listo: ${nombre} ya puede entrar al panel con su correo y contraseña, con perfil ${nombrePerfil(perfil)}.` };
}

/** ADMINISTRADOR: cambia nombre, perfil y estado de una persona. */
export async function guardarPersonal(id: string, _: Resultado | null, f: FormData): Promise<Resultado> {
  const nombre = texto(f, 'nombre');
  const perfil = texto(f, 'perfil');
  if (!nombre) return { ok: false, mensaje: 'Escriba el nombre.', campo: 'nombre', errorCampo: 'Dato obligatorio.' };
  if (!esPerfil(perfil)) return { ok: false, mensaje: 'Elija el perfil.', campo: 'perfil', errorCampo: 'Dato obligatorio.' };
  const activo = f.get('activo') === 'on';
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc('guardar_personal', { p_usuario: id, p_nombre: nombre, p_perfil: perfil, p_activo: activo });
  if (error) return { ok: false, mensaje: error.message };
  revalidatePath('/usuarios');
  return { ok: true, mensaje: `Guardado: ${nombre}, ${nombrePerfil(perfil)}${activo ? '' : ' (inactivo)'}.` };
}
