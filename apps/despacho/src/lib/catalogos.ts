import 'server-only';
import { crearClienteServidor } from '@/lib/supabase/server';

export interface CatalogosCamion {
  transportistas: { id: string; nombre: string }[];
  conductores: { id: string; nombre: string; transportista_id: string }[];
  vehiculos: { id: string; nombre: string; transportista_id: string }[];
}

export async function cargarCatalogosCamion(): Promise<CatalogosCamion> {
  const supabase = await crearClienteServidor();
  const [t, c, v] = await Promise.all([
    supabase.from('transportistas').select('id, razon_social').order('razon_social'),
    supabase.from('conductores').select('id, nombre, transportista_id').eq('activo', true).order('nombre'),
    supabase.from('vehiculos').select('id, placa, marca, transportista_id').order('placa'),
  ]);
  return {
    transportistas: (t.data ?? []).map((x) => ({ id: x.id, nombre: x.razon_social })),
    conductores: (c.data ?? []).map((x) => ({ id: x.id, nombre: x.nombre, transportista_id: x.transportista_id })),
    vehiculos: (v.data ?? []).map((x) => ({
      id: x.id,
      nombre: x.marca ? `${x.placa} · ${x.marca}` : x.placa,
      transportista_id: x.transportista_id,
    })),
  };
}
