import 'server-only';
import { cargarProductos } from '@/lib/productosServidor';
import { crearClienteServidor } from '@/lib/supabase/server';

/** Perfil del usuario y si puede cargar pedidos (administrador o comercial). */
export async function permisosPedidos() {
  const supabase = await crearClienteServidor();
  const [{ data: perfil }, { data: usuario }] = await Promise.all([supabase.rpc('perfil_actual'), supabase.auth.getUser()]);
  const p = (perfil as string | null) ?? null;
  return { perfil: p, usuarioId: usuario.user?.id ?? null, puedeCargar: p === 'administrador' || p === 'comercial' };
}

/**
 * Clientes y destinos para el formulario. Un comercial ve solo sus clientes y los que no tienen
 * comercial asignado (la base de datos aplica la misma regla al guardar).
 */
export async function opcionesPedido() {
  const supabase = await crearClienteServidor();
  const [{ perfil, usuarioId }, { data: clientes }, { data: ubicaciones }] = await Promise.all([
    permisosPedidos(),
    supabase.from('clientes').select('id, razon_social, nit_ruc, comercial_id').order('razon_social'),
    supabase.from('ubicaciones').select('id, nombre, ciudad, pais').eq('activo', true).order('nombre'),
  ]);
  const productos = await cargarProductos(true);
  const todos = (clientes ?? []) as { id: string; razon_social: string; nit_ruc: string | null; comercial_id: string | null }[];
  const propios = perfil === 'comercial' ? todos.filter((c) => !c.comercial_id || c.comercial_id === usuarioId) : todos;
  return {
    clientes: propios.map(({ id, razon_social, nit_ruc }) => ({ id, razon_social, nit_ruc })),
    ubicaciones: (ubicaciones ?? []) as { id: string; nombre: string; ciudad: string | null; pais: string }[],
    productos,
  };
}

/** Nombre de cada comercial activo (la tabla de usuarios solo la lee el administrador). */
export async function nombresComerciales(): Promise<Map<string, string>> {
  const supabase = await crearClienteServidor();
  const { data } = await supabase.rpc('comerciales');
  return new Map(((data ?? []) as { id: string; nombre: string }[]).map((c) => [c.id, c.nombre]));
}
