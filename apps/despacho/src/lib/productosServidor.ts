import 'server-only';
import { crearClienteServidor } from '@/lib/supabase/server';
import type { Producto } from '@/lib/productos';

/** Productos del catálogo (activos primero). Con `soloActivos`, solo los que se ofrecen en las listas. */
export async function cargarProductos(soloActivos = false): Promise<Producto[]> {
  const supabase = await crearClienteServidor();
  let consulta = supabase.from('productos').select('id, nombre, codigo, presentacion, activo')
    .order('activo', { ascending: false }).order('nombre');
  if (soloActivos) consulta = consulta.eq('activo', true);
  const { data } = await consulta;
  return (data ?? []) as Producto[];
}
