import Link from 'next/link';
import { crearClienteServidor } from '@/lib/supabase/server';
import FiltrosAutomaticos from '@/componentes/FiltrosAutomaticos';
import { ESTADO_PEDIDO, formatoFecha, formatoToneladas, proximaEntrega, toneladasVivas } from '@/lib/pedidos';

import { permisosPedidos } from '@/lib/pedidosServidor';

export const dynamic = 'force-dynamic';

interface FilaPedido {
  id: string; codigo: string; orden_compra: string | null; producto: string; incoterm: string; estado: string; creado_en: string;
  toneladas: number; entrega_hasta: string;
  cliente: { razon_social: string } | null;
  destino: { nombre: string; pais: string } | null;
  envios: { toneladas: number; entrega_vigente: string; entrega_comprometida: string | null; estado: string }[];
}

const hoy = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/La_Paz' });

/** Pedidos de clientes con su programa de envíos. */
export default async function PaginaPedidos({ searchParams }: { searchParams: Promise<{ estado?: string; cliente?: string; q?: string }> }) {
  const sp = await searchParams;
  const supabase = await crearClienteServidor();
  let consulta = supabase.from('pedidos')
    .select('id, codigo, orden_compra, producto, incoterm, estado, creado_en, toneladas, entrega_hasta, cliente:clientes(razon_social), destino:ubicaciones(nombre, pais), envios:programa_envios(toneladas, entrega_vigente, entrega_comprometida, estado)')
    .order('creado_en', { ascending: false })
    .limit(200);
  // Por defecto se ven los abiertos; «Todos» incluye cumplidos y cancelados.
  if (sp.estado && sp.estado !== 'todos') consulta = consulta.eq('estado', sp.estado);
  else if (!sp.estado) consulta = consulta.in('estado', ['borrador', 'confirmado', 'en_ejecucion']);
  if (sp.cliente) consulta = consulta.eq('cliente_id', sp.cliente);
  const q = sp.q?.trim();
  const patron = q?.replace(/[%,()*]/g, '');
  if (patron) consulta = consulta.or(`codigo.ilike.%${patron}%,orden_compra.ilike.%${patron}%,producto.ilike.%${patron}%`);

  const [{ data, error }, { data: clientes }, { puedeCargar }] = await Promise.all([
    consulta,
    supabase.from('clientes').select('id, razon_social').order('razon_social'),
    permisosPedidos(),
  ]);
  if (error) {
    return (
      <section className="tarjeta"><h1>Pedidos</h1>
        <div className="mensaje-error">No se pudo cargar la lista: {error.message.includes('pedidos') ? 'falta aplicar la migración de pedidos en Supabase.' : error.message}</div>
      </section>
    );
  }
  const pedidos = (data ?? []) as unknown as FilaPedido[];
  const fechaHoy = hoy();
  const hayFiltros = !!(sp.estado || sp.cliente || q);

  return (
    <section className="tarjeta">
      <div className="cabecera-seccion">
        <h1 style={{ margin: 0 }}>Pedidos</h1>
        {puedeCargar && (
          <div className="botones">
            <a className="enlace-secundario" href="/plantilla-pedidos.xlsx" download>Descargar plantilla Excel</a>
            <Link className="boton secundario" href="/pedidos/importar">Importar desde Excel</Link>
            <Link className="boton" href="/pedidos/nuevo">Nuevo pedido</Link>
          </div>
        )}
      </div>

      <FiltrosAutomaticos className="filtros-misiones">
        <label>Buscar<input name="q" defaultValue={q ?? ''} placeholder="Código, orden de compra o producto" /></label>
        <label>Estado
          <select name="estado" defaultValue={sp.estado ?? ''}>
            <option value="">Abiertos</option>
            {Object.entries(ESTADO_PEDIDO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            <option value="todos">Todos</option>
          </select>
        </label>
        <label>Cliente
          <select name="cliente" defaultValue={sp.cliente ?? ''}>
            <option value="">Todos</option>
            {(clientes ?? []).map((c) => <option key={c.id} value={c.id}>{c.razon_social}</option>)}
          </select>
        </label>
        <div className="acciones-filtro">
          <button className="boton">Buscar</button>
          {hayFiltros && <Link href="/pedidos" className="enlace-cancelar">Limpiar</Link>}
        </div>
      </FiltrosAutomaticos>

      <p style={{ fontSize: 14, color: 'var(--gris)' }} role="status">
        {pedidos.length === 0 ? 'Sin pedidos' : `${pedidos.length} ${pedidos.length === 1 ? 'pedido' : 'pedidos'}${pedidos.length === 200 ? ' (los 200 más nuevos)' : ''}`}
      </p>
      {pedidos.length === 0 && !hayFiltros && puedeCargar && (
        <p>Todavía no hay pedidos. Cree el primero con «Nuevo pedido» o importe su planilla con «Importar desde Excel».</p>
      )}
      {pedidos.length > 0 && (
        <div className="tabla-desplazable">
          <table className="tabla-pedidos tabla-tarjetas">
            <thead><tr><th>Código</th><th>Cliente</th><th>Orden de compra</th><th>Producto</th><th>Destino</th><th>Pedido</th><th>Programado</th><th>Fecha límite</th><th>Próxima entrega</th><th>Estado</th></tr></thead>
            <tbody>{pedidos.map((p) => {
              const proxima = proximaEntrega(p.envios);
              const programado = toneladasVivas(p.envios);
              const pct = Math.round((programado / Number(p.toneladas)) * 100);
              const abierto = ['borrador', 'confirmado', 'en_ejecucion'].includes(p.estado);
              const atrasado = !!proxima && proxima < fechaHoy;
              return (
                <tr key={p.id}>
                  <td><Link href={`/pedidos/${p.id}`}>{p.codigo}</Link></td>
                  <td data-etiqueta="Cliente">{p.cliente?.razon_social}</td>
                  <td data-etiqueta="Orden de compra">{p.orden_compra ?? '—'}</td>
                  <td data-etiqueta="Producto">{p.producto}</td>
                  <td data-etiqueta="Destino">{p.incoterm} {p.destino?.nombre} ({p.destino?.pais})</td>
                  <td data-etiqueta="Pedido" className="numero">{formatoToneladas(Number(p.toneladas))}</td>
                  <td data-etiqueta="Programado" className="numero">
                    {formatoToneladas(programado)} <span className={abierto && pct < 97 ? 'docs-faltan' : 'ayuda-campo'} style={{ display: 'inline' }}>({pct} %)</span>
                  </td>
                  <td data-etiqueta="Fecha límite" style={{ whiteSpace: 'nowrap' }}>{formatoFecha(p.entrega_hasta)}</td>
                  <td data-etiqueta="Próxima entrega" style={{ whiteSpace: 'nowrap' }}>
                    {proxima ? <>{formatoFecha(proxima)}{atrasado && <span className="docs-faltan"> · vencida</span>}</> : '—'}
                  </td>
                  <td data-etiqueta="Estado"><span className={`etiqueta pedido-${p.estado}`}>{ESTADO_PEDIDO[p.estado] ?? p.estado}</span></td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
