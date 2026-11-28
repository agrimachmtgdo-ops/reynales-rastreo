import 'server-only';
import { ETAPAS, type Etapa } from '@reynales/shared';
import { crearClienteServidor } from '@/lib/supabase/server';

export interface FiltrosMisiones {
  q?: string;
  etapa?: string;
  desde?: string;
  hasta?: string;
  producto?: string;
  pagina?: string;
}

/** Misiones por página en la lista. */
export const POR_PAGINA = 50;

export interface FilaMision {
  id: string;
  codigo: string;
  etapa: Etapa;
  factura: string | null;
  guia: string | null;
  dex: string | null;
  tonelaje_objetivo: number | null;
  creado_en: string;
  entrega_comprometida: string | null;
  tipo_carga: string | null;
  producto: { id: string; nombre: string } | null;
  envio: { id: string; numero: number; pedido: { id: string; codigo: string; producto: string | null } | null } | null;
  cliente: { razon_social: string } | null;
  origen: { nombre: string } | null;
  destino: { nombre: string; pais: string } | null;
  asignaciones: { ultima_senal: string | null; etapa: Etapa; tramo: number; toneladas_cargadas: number | null; vehiculo: { placa: string } | null; conductor: { nombre: string } | null }[];
  tramos: { numero: number }[];
  documentos: { tipo: string; etiqueta: string | null; reemplazado_por: string | null }[];
}

// Solo letras, números, espacios, guiones y puntos: el texto va dentro de un filtro de la API.
const limpiar = (t: string) => t.replace(/[^\p{L}\p{N} .\-_/]/gu, '').trim().slice(0, 60);
const fechaValida = (f?: string) => (f && /^\d{4}-\d{2}-\d{2}$/.test(f) ? f : undefined);

/** Busca misiones por código, factura, guía, DEX, placa o cliente, con filtros de etapa y fecha. */
export async function buscarMisiones(
  filtros: FiltrosMisiones,
  limite = POR_PAGINA,
  desdeFila = 0,
): Promise<{ filas: FilaMision[]; total: number; error?: string }> {
  const supabase = await crearClienteServidor();
  let consulta = supabase
    .from('misiones')
    .select(`id, codigo, etapa, factura, guia, dex, tonelaje_objetivo, creado_en, entrega_comprometida, tipo_carga,
             producto:productos(id, nombre),
             envio:programa_envios(id, numero, pedido:pedidos(id, codigo, producto)),
             cliente:clientes(razon_social), origen:ubicaciones!misiones_origen_id_fkey(nombre),
             destino:ubicaciones!misiones_destino_id_fkey(nombre, pais),
             asignaciones(ultima_senal, etapa, tramo, toneladas_cargadas, vehiculo:vehiculos(placa), conductor:conductores(nombre)),
             tramos(numero), documentos(tipo, etiqueta, reemplazado_por)`, { count: 'exact' })
    .order('creado_en', { ascending: false })
    .range(desdeFila, desdeFila + limite - 1);

  const q = limpiar(filtros.q ?? '');
  if (q) {
    const patron = `%${q}%`;
    const [clientes, vehiculos] = await Promise.all([
      supabase.from('clientes').select('id').ilike('razon_social', patron).limit(50),
      supabase.from('vehiculos').select('id').ilike('placa', patron).limit(50),
    ]);
    const idsVeh = (vehiculos.data ?? []).map((v) => v.id);
    const misionesPorPlaca = idsVeh.length
      ? ((await supabase.from('asignaciones').select('mision_id').in('vehiculo_id', idsVeh).limit(200)).data ?? []).map((a) => a.mision_id)
      : [];
    const condiciones = ['codigo', 'factura', 'guia', 'dex'].map((c) => `${c}.ilike.*${q}*`);
    const idsCli = (clientes.data ?? []).map((c) => c.id);
    if (idsCli.length) condiciones.push(`cliente_id.in.(${idsCli.join(',')})`);
    if (misionesPorPlaca.length) condiciones.push(`id.in.(${[...new Set(misionesPorPlaca)].join(',')})`);
    consulta = consulta.or(condiciones.join(','));
  }
  if (filtros.etapa && (ETAPAS as readonly string[]).includes(filtros.etapa)) consulta = consulta.eq('etapa', filtros.etapa as Etapa);
  const desde = fechaValida(filtros.desde);
  const hasta = fechaValida(filtros.hasta);
  // Fechas en hora de Bolivia (UTC-4).
  if (desde) consulta = consulta.gte('creado_en', `${desde}T00:00:00-04:00`);
  if (hasta) consulta = consulta.lte('creado_en', `${hasta}T23:59:59-04:00`);
  if (filtros.producto && /^[0-9a-f-]{36}$/i.test(filtros.producto)) consulta = consulta.eq('producto_id', filtros.producto);

  const { data, error, count } = await consulta;
  if (error) return { filas: [], total: 0, error: error.message };
  return { filas: (data ?? []) as unknown as FilaMision[], total: count ?? (data ?? []).length };
}
