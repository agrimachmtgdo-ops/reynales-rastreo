/**
 * Lectura de pedidos desde una hoja de Excel (ya convertida a filas).
 * Reconoce los títulos de columna aunque cambien un poco («OC», «N° OC», «Orden de compra»…),
 * agrupa en un pedido las filas con el mismo cliente y orden de compra (cada fila = un envío)
 * y devuelve, por pedido, los datos listos para guardar o los errores que hay que corregir.
 */
import { INCOTERMS } from './pedidos';

export type Celda = string | number | boolean | Date | null | undefined;
export interface ClienteRef { id: string; razon_social: string; nit_ruc: string | null }
export interface UbicacionRef { id: string; nombre: string; ciudad: string | null }

export type Campo = 'orden_compra' | 'cliente' | 'nit' | 'producto' | 'destino' | 'incoterm' | 'toneladas' | 'entrega' | 'carga' | 'notas';

const SINONIMOS: Record<Campo, string[]> = {
  orden_compra: ['orden de compra', 'oc', 'o c', 'n oc', 'n o c', 'no oc', 'no o c', 'nro oc', 'nro o c', 'numero de oc', 'orden', 'pedido cliente', 'po'],
  cliente: ['cliente', 'razon social', 'nombre del cliente', 'comprador'],
  nit: ['nit', 'ruc', 'nit ruc', 'nit o ruc', 'rut'],
  producto: ['producto', 'descripcion', 'mercaderia', 'articulo'],
  destino: ['destino', 'lugar de entrega', 'lugar', 'punto de entrega'],
  incoterm: ['incoterm', 'incoterms', 'condicion de entrega', 'condicion'],
  toneladas: ['toneladas', 'tn', 'ton', 't', 'tm', 'cantidad', 'cantidad tn', 'peso', 'peso tn'],
  entrega: ['fecha de entrega', 'entrega', 'fecha entrega', 'fecha comprometida', 'fecha'],
  carga: ['fecha de carga', 'carga', 'fecha carga'],
  notas: ['notas', 'observaciones', 'obs', 'comentarios'],
};
export const TITULOS: Record<Campo, string> = {
  orden_compra: 'Orden de compra', cliente: 'Cliente', nit: 'NIT/RUC', producto: 'Producto', destino: 'Destino',
  incoterm: 'Incoterm', toneladas: 'Toneladas', entrega: 'Fecha de entrega', carga: 'Fecha de carga', notas: 'Notas',
};

/** Minúsculas, sin tildes ni signos: «N° O.C.» → «n oc». */
export function normalizar(t: unknown): string {
  return String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[º°]/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Busca la fila de títulos (entre las 10 primeras) y qué columna es cada campo. */
export function encontrarColumnas(filas: Celda[][]): { fila: number; columnas: Partial<Record<Campo, number>> } | null {
  for (let i = 0; i < Math.min(10, filas.length); i++) {
    const columnas: Partial<Record<Campo, number>> = {};
    (filas[i] ?? []).forEach((celda, j) => {
      const t = normalizar(celda);
      if (!t) return;
      for (const campo of Object.keys(SINONIMOS) as Campo[]) {
        if (columnas[campo] === undefined && SINONIMOS[campo].includes(t)) { columnas[campo] = j; break; }
      }
    });
    if (Object.keys(columnas).length >= 3) return { fila: i, columnas };
  }
  return null;
}

const DIA = 86_400_000;
/** Fecha de Excel (Date, número de serie, «10/12/2026», «2026-12-10») → «2026-12-10». */
export function leerFecha(v: Celda): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    // La librería entrega las fechas de Excel a medianoche UTC: leer en UTC evita que en Bolivia (UTC−4) quede el día anterior.
    return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  }
  if (typeof v === 'number') {
    if (v < 20000 || v > 80000) return null; // número de serie de Excel entre 1954 y 2119
    return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * DIA).toISOString().slice(0, 10);
  }
  const t = String(v).trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return armar(+m[1]!, +m[2]!, +m[3]!);
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) return armar(m[3]!.length === 2 ? 2000 + +m[3]! : +m[3]!, +m[2]!, +m[1]!); // día/mes/año
  return null;
}
function armar(a: number, m: number, d: number): string | null {
  const f = new Date(Date.UTC(a, m - 1, d));
  return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d ? f.toISOString().slice(0, 10) : null;
}

/** «28», 28, «28,5», «28.500,25 t» → número; null si no se puede. */
export function leerNumero(v: Celda): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v == null) return null;
  let t = String(v).replace(/[^0-9.,-]/g, '');
  if (!t) return null;
  if (t.includes(',') && t.includes('.')) t = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  else t = t.replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const texto = (v: Celda) => (v instanceof Date ? leerFecha(v) ?? '' : String(v ?? '').trim());
const soloDigitos = (t: string | null | undefined) => (t ?? '').replace(/\D/g, '');

/** El único elemento que coincide exactamente, o si no, el único que lo contiene. */
function unico<T>(lista: T[], valor: string, claves: (x: T) => (string | null)[]): T | null {
  const n = normalizar(valor);
  if (!n) return null;
  const exactos = lista.filter((x) => claves(x).some((c) => normalizar(c) === n));
  if (exactos.length === 1) return exactos[0]!;
  if (exactos.length > 1) return null;
  const parecidos = lista.filter((x) => claves(x).some((c) => { const k = normalizar(c); return !!k && (k.includes(n) || n.includes(k)); }));
  return parecidos.length === 1 ? parecidos[0]! : null;
}

export interface EnvioImportado { toneladas: number; entrega: string; carga: string | null; fila: number }
export interface PedidoImportado {
  clave: string;
  filas: number[];
  clienteNombre: string;
  datos: { cliente_id: string; orden_compra: string | null; producto: string; destino_id: string; incoterm: string; notas: string | null; origen: 'excel' } | null;
  destinoNombre: string;
  envios: EnvioImportado[];
  errores: string[];
}
export interface ResultadoLectura { pedidos: PedidoImportado[]; error: string | null; filasLeidas: number }

export interface ProductoRef { nombre: string; codigo: string | null }

/** `productos`: catálogo activo; el producto de cada fila se busca por nombre o por código. Sin catálogo no se valida. */
export function leerPedidos(filas: Celda[][], clientes: ClienteRef[], ubicaciones: UbicacionRef[], productos: ProductoRef[] = []): ResultadoLectura {
  const cab = encontrarColumnas(filas);
  if (!cab) {
    return { pedidos: [], filasLeidas: 0, error: 'No encontré la fila de títulos. La hoja debe tener columnas como «Cliente», «Producto», «Destino», «Incoterm», «Toneladas» y «Fecha de entrega». Puede usar la plantilla.' };
  }
  const faltan = (['cliente', 'producto', 'toneladas', 'entrega'] as Campo[]).filter((c) => cab.columnas[c] === undefined && !(c === 'cliente' && cab.columnas.nit !== undefined));
  if (faltan.length) {
    return { pedidos: [], filasLeidas: 0, error: `Faltan columnas: ${faltan.map((c) => `«${TITULOS[c]}»`).join(', ')}.` };
  }
  const celda = (fila: Celda[], c: Campo) => (cab.columnas[c] === undefined ? null : fila[cab.columnas[c]!]);
  const porClave = new Map<string, PedidoImportado>();
  let leidas = 0;

  filas.slice(cab.fila + 1).forEach((fila, k) => {
    const numFila = cab.fila + 2 + k; // número de fila como lo ve Excel
    if (!fila || fila.every((c) => c == null || String(c).trim() === '')) return;
    leidas++;
    const errores: string[] = [];
    const nit = soloDigitos(texto(celda(fila, 'nit')));
    const nombreCliente = texto(celda(fila, 'cliente'));
    const cliente = (nit && clientes.find((c) => soloDigitos(c.nit_ruc) === nit)) || unico(clientes, nombreCliente, (c) => [c.razon_social]);
    if (!cliente) errores.push(`Fila ${numFila}: no encontré el cliente «${nombreCliente || nit}». Regístrelo en Catálogos o corrija el nombre.`);

    let incotermTexto = texto(celda(fila, 'incoterm')).toUpperCase();
    let lugar = texto(celda(fila, 'destino'));
    const partes = incotermTexto.split(/\s+/);
    const incoterm = (INCOTERMS as readonly string[]).includes(partes[0] ?? '') ? partes[0]! : '';
    if (!lugar && partes.length > 1) lugar = texto(celda(fila, 'incoterm')).split(/\s+/).slice(1).join(' '); // «CPT Desaguadero»
    if (!incoterm) errores.push(`Fila ${numFila}: el Incoterm «${incotermTexto || 'vacío'}» no es válido (use CPT, FCA, FOB, EXW…).`);
    const destino = unico(ubicaciones, lugar, (u) => [u.nombre, u.ciudad]);
    if (!destino) errores.push(`Fila ${numFila}: no encontré el destino «${lugar || 'vacío'}» en Catálogos → Ubicaciones.`);

    const escrito = texto(celda(fila, 'producto'));
    // Se guarda el nombre exacto del catálogo, así la base enlaza el producto.
    const delCatalogo = escrito && productos.length
      ? productos.find((p) => normalizar(p.nombre) === normalizar(escrito) || (p.codigo && normalizar(p.codigo) === normalizar(escrito)))
      : undefined;
    const producto = delCatalogo ? delCatalogo.nombre : escrito;
    if (!escrito) errores.push(`Fila ${numFila}: falta el producto.`);
    else if (productos.length && !delCatalogo) errores.push(`Fila ${numFila}: el producto «${escrito}» no está en Catálogos → Productos. Agréguelo o corrija el nombre en el Excel.`);
    const toneladas = leerNumero(celda(fila, 'toneladas'));
    if (toneladas == null || toneladas <= 0) errores.push(`Fila ${numFila}: las toneladas deben ser un número mayor que 0.`);
    const entrega = leerFecha(celda(fila, 'entrega'));
    if (!entrega) errores.push(`Fila ${numFila}: la fecha de entrega «${texto(celda(fila, 'entrega')) || 'vacía'}» no es válida (use día/mes/año).`);
    const cargaCelda = celda(fila, 'carga');
    const carga = leerFecha(cargaCelda);
    if (cargaCelda != null && String(cargaCelda).trim() !== '' && !carga) errores.push(`Fila ${numFila}: la fecha de carga no es válida.`);
    if (carga && entrega && carga > entrega) errores.push(`Fila ${numFila}: la fecha de carga es posterior a la de entrega.`);

    const oc = texto(celda(fila, 'orden_compra')) || null;
    // Sin orden de compra cada fila es un pedido aparte.
    const clave = oc && cliente ? `${cliente.id}|${normalizar(oc)}` : `fila-${numFila}`;
    let pedido = porClave.get(clave);
    if (!pedido) {
      pedido = {
        clave, filas: [], clienteNombre: cliente?.razon_social ?? nombreCliente, destinoNombre: destino?.nombre ?? lugar, envios: [], errores: [],
        datos: cliente && destino && incoterm && producto && (!productos.length || delCatalogo)
          ? { cliente_id: cliente.id, orden_compra: oc, producto, destino_id: destino.id, incoterm, notas: texto(celda(fila, 'notas')) || null, origen: 'excel' }
          : null,
      };
      porClave.set(clave, pedido);
    } else if (pedido.datos && (normalizar(producto) !== normalizar(pedido.datos.producto) || destino?.id !== pedido.datos.destino_id || incoterm !== pedido.datos.incoterm)) {
      errores.push(`Fila ${numFila}: la orden ${oc} ya tiene otro producto, destino o Incoterm en una fila anterior. Un pedido lleva un solo producto y destino.`);
    }
    pedido.filas.push(numFila);
    pedido.errores.push(...errores);
    if (!errores.length && toneladas && entrega) pedido.envios.push({ toneladas, entrega, carga, fila: numFila });
  });

  const pedidos = [...porClave.values()];
  for (const p of pedidos) {
    if (!p.datos && !p.errores.length) p.errores.push(`Filas ${p.filas.join(', ')}: faltan datos del pedido.`);
    p.envios.sort((a, b) => a.entrega.localeCompare(b.entrega));
  }
  return { pedidos, error: leidas === 0 ? 'La hoja no tiene filas con pedidos debajo de los títulos.' : null, filasLeidas: leidas };
}
