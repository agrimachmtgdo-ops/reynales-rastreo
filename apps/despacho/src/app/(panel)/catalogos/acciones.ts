'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { crearClienteServidor } from '@/lib/supabase/server';

export interface Resultado {
  ok: boolean;
  mensaje: string;
}

type Tabla = 'clientes' | 'transportistas' | 'conductores' | 'vehiculos' | 'ubicaciones';

const texto = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
};
const numero = (f: FormData, k: string) => {
  const v = texto(f, k);
  return v === null ? null : Number(v.replace(',', '.'));
};

// ---- Lectura de cada formulario (la misma para crear y editar) ----
const DATOS: Record<Tabla, (f: FormData) => Record<string, unknown>> = {
  clientes: (f) => ({
    razon_social: texto(f, 'razon_social'),
    nit_ruc: texto(f, 'nit_ruc'),
    pais: texto(f, 'pais') ?? 'BO',
    contacto: texto(f, 'contacto'),
    whatsapp: texto(f, 'whatsapp'),
    correo: texto(f, 'correo'),
  }),
  transportistas: (f) => ({
    razon_social: texto(f, 'razon_social'),
    nit: texto(f, 'nit'),
    contacto: texto(f, 'contacto'),
    telefono: texto(f, 'telefono'),
    clausula_rastreo_aceptada_en: texto(f, 'clausula_rastreo_aceptada_en'),
  }),
  conductores: (f) => ({
    transportista_id: texto(f, 'transportista_id'),
    nombre: texto(f, 'nombre'),
    ci: texto(f, 'ci'),
    telefono: texto(f, 'telefono'),
    licencia: texto(f, 'licencia'),
  }),
  vehiculos: (f) => ({
    transportista_id: texto(f, 'transportista_id'),
    placa: texto(f, 'placa')?.toUpperCase().replace(/\s+/g, ''),
    marca: texto(f, 'marca'),
    capacidad_tn: numero(f, 'capacidad_tn'),
  }),
  ubicaciones: (f) => ({
    nombre: texto(f, 'nombre'),
    ciudad: texto(f, 'ciudad'),
    pais: texto(f, 'pais') ?? 'BO',
    tipo: texto(f, 'tipo'),
    lat: numero(f, 'lat'),
    lon: numero(f, 'lon'),
    radio_m: numero(f, 'radio_m') ?? 500,
  }),
};

const ETIQUETA: Record<Tabla, string> = {
  clientes: 'Cliente',
  transportistas: 'Transportista',
  conductores: 'Chofer',
  vehiculos: 'Vehículo',
  ubicaciones: 'Ubicación',
};

// Campo que identifica a cada registro, para avisar de duplicados.
const CAMPO_NOMBRE: Partial<Record<Tabla, string>> = {
  clientes: 'razon_social',
  transportistas: 'razon_social',
  conductores: 'nombre',
  ubicaciones: 'nombre',
};

function mensajeError(error: { code?: string; message: string }): string {
  if (error.code === '23505') return 'Ya existe un registro con ese dato (por ejemplo, la misma placa).';
  if (error.code === '23514') return 'Algún dato no tiene el formato correcto (revise placa, coordenadas o radio).';
  if (error.code === '42501') return 'Su usuario no tiene permiso para modificar catálogos.';
  return `No se pudo guardar: ${error.message}`;
}

async function hayDuplicado(tabla: Tabla, fila: Record<string, unknown>, exceptoId?: string) {
  const campo = CAMPO_NOMBRE[tabla];
  const valor = campo ? fila[campo] : null;
  if (!campo || typeof valor !== 'string') return false;
  const supabase = await crearClienteServidor();
  let consulta = supabase.from(tabla).select('id').ilike(campo, valor).limit(1);
  if (exceptoId) consulta = consulta.neq('id', exceptoId);
  const { data } = await consulta;
  return (data ?? []).length > 0;
}

async function crear(tabla: Tabla, f: FormData): Promise<Resultado> {
  const fila = DATOS[tabla](f);
  if (await hayDuplicado(tabla, fila)) {
    return { ok: false, mensaje: `Ya existe un registro llamado "${String(fila[CAMPO_NOMBRE[tabla]!])}". Use "Editar" en la lista.` };
  }
  const supabase = await crearClienteServidor();
  const { error } = await supabase.from(tabla).insert(fila);
  if (error) return { ok: false, mensaje: mensajeError(error) };
  revalidatePath('/catalogos');
  return { ok: true, mensaje: `${ETIQUETA[tabla]} guardado.` };
}

async function actualizar(tabla: Tabla, id: string, f: FormData): Promise<Resultado> {
  const fila = DATOS[tabla](f);
  if (await hayDuplicado(tabla, fila, id)) {
    return { ok: false, mensaje: `Ya existe otro registro llamado "${String(fila[CAMPO_NOMBRE[tabla]!])}".` };
  }
  const supabase = await crearClienteServidor();
  const { error } = await supabase.from(tabla).update(fila).eq('id', id);
  if (error) return { ok: false, mensaje: mensajeError(error) };
  revalidatePath('/catalogos');
  redirect(`/catalogos?pestana=${tabla}&guardado=1`);
}

export async function crearCliente(_: Resultado | null, f: FormData) { return crear('clientes', f); }
export async function crearTransportista(_: Resultado | null, f: FormData) { return crear('transportistas', f); }
export async function crearConductor(_: Resultado | null, f: FormData) { return crear('conductores', f); }
export async function crearVehiculo(_: Resultado | null, f: FormData) { return crear('vehiculos', f); }
export async function crearUbicacion(_: Resultado | null, f: FormData) { return crear('ubicaciones', f); }

export async function actualizarRegistro(tabla: Tabla, id: string, _: Resultado | null, f: FormData) {
  return actualizar(tabla, id, f);
}

/** Activa o desactiva un chofer o una ubicación (no se borran, para conservar el historial). */
export async function alternarActivo(tabla: 'conductores' | 'ubicaciones', id: string, activo: boolean) {
  const supabase = await crearClienteServidor();
  await supabase.from(tabla).update({ activo }).eq('id', id);
  revalidatePath('/catalogos');
}
