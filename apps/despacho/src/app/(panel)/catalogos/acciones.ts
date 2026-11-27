'use server';
import { revalidatePath } from 'next/cache';
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

async function insertar(tabla: string, fila: Record<string, unknown>, etiqueta: string): Promise<Resultado> {
  const supabase = await crearClienteServidor();
  const { error } = await supabase.from(tabla).insert(fila);
  if (error) return { ok: false, mensaje: `No se pudo guardar: ${error.message}` };
  revalidatePath('/catalogos');
  return { ok: true, mensaje: `${etiqueta} guardado.` };
}

export async function crearCliente(_: Resultado | null, f: FormData) {
  return insertar('clientes', {
    razon_social: texto(f, 'razon_social'),
    nit_ruc: texto(f, 'nit_ruc'),
    pais: texto(f, 'pais') ?? 'BO',
    contacto: texto(f, 'contacto'),
    whatsapp: texto(f, 'whatsapp'),
    correo: texto(f, 'correo'),
  }, 'Cliente');
}

export async function crearTransportista(_: Resultado | null, f: FormData) {
  return insertar('transportistas', {
    razon_social: texto(f, 'razon_social'),
    nit: texto(f, 'nit'),
    contacto: texto(f, 'contacto'),
    telefono: texto(f, 'telefono'),
    clausula_rastreo_aceptada_en: texto(f, 'clausula_rastreo_aceptada_en'),
  }, 'Transportista');
}

export async function crearConductor(_: Resultado | null, f: FormData) {
  return insertar('conductores', {
    transportista_id: texto(f, 'transportista_id'),
    nombre: texto(f, 'nombre'),
    ci: texto(f, 'ci'),
    telefono: texto(f, 'telefono'),
    licencia: texto(f, 'licencia'),
  }, 'Chofer');
}

export async function crearVehiculo(_: Resultado | null, f: FormData) {
  return insertar('vehiculos', {
    transportista_id: texto(f, 'transportista_id'),
    placa: texto(f, 'placa')?.toUpperCase().replace(/\s+/g, ''),
    marca: texto(f, 'marca'),
    capacidad_tn: numero(f, 'capacidad_tn'),
  }, 'Vehículo');
}

export async function crearUbicacion(_: Resultado | null, f: FormData) {
  return insertar('ubicaciones', {
    nombre: texto(f, 'nombre'),
    ciudad: texto(f, 'ciudad'),
    pais: texto(f, 'pais') ?? 'BO',
    tipo: texto(f, 'tipo'),
    lat: numero(f, 'lat'),
    lon: numero(f, 'lon'),
    radio_m: numero(f, 'radio_m') ?? 500,
  }, 'Ubicación');
}
