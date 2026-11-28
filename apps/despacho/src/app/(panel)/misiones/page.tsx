import { cargarProductos } from '@/lib/productosServidor';
import Link from 'next/link';
import { ETAPAS, ETIQUETA_ETAPA } from '@reynales/shared';
import { buscarMisiones, POR_PAGINA, type FiltrosMisiones } from '@/lib/misiones';
import { enTransbordo, formatoHora, haceCuanto } from '@/lib/tipos';
import FiltrosAutomaticos from '@/componentes/FiltrosAutomaticos';
import { claveDe, estadoDocumentos } from '@/lib/documentos';
import { formatoFecha, formatoToneladas, plural } from '@/lib/pedidos';

export const dynamic = 'force-dynamic';

export default async function PaginaMisiones({ searchParams }: { searchParams: Promise<FiltrosMisiones> }) {
  const filtros = await searchParams;
  const pagina = Math.max(1, Math.floor(Number(filtros.pagina) || 1));
  const [{ filas: misiones, total, error }, productos] = await Promise.all([
    buscarMisiones(filtros, POR_PAGINA, (pagina - 1) * POR_PAGINA),
    cargarProductos(),
  ]);
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  if (error) return <div className="mensaje-error">{error}</div>;

  const hayFiltros = !!(filtros.q || filtros.etapa || filtros.desde || filtros.hasta || filtros.producto);
  const soloFiltros = Object.entries(filtros).filter(([k, v]) => k !== 'pagina' && typeof v === 'string' && v !== '') as [string, string][];
  const parametros = new URLSearchParams(soloFiltros).toString();
  const enlacePagina = (n: number) => `/misiones?${new URLSearchParams([...soloFiltros, ['pagina', String(n)]]).toString()}`;
  // Documentos obligatorios que faltan (factura; DEX si sale de Bolivia).
  const faltanDocs = (m: (typeof misiones)[number]) =>
    estadoDocumentos((m.documentos ?? []).filter((d) => !d.reemplazado_por).map((d) => claveDe(d.tipo, d.etiqueta)), m.destino?.pais)
      .filter((e) => e.obligatorio && !e.tiene).map((e) => e.nombre);
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/La_Paz' });
  const ultimaSenal = (m: (typeof misiones)[number]) =>
    m.asignaciones.map((a) => a.ultima_senal).filter((t): t is string => !!t).sort().at(-1) ?? null;

  return (
    <section className="tarjeta">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>Misiones</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a className="boton secundario" href={`/misiones/exportar${parametros ? `?${parametros}` : ''}`}>Exportar a Excel (CSV)</a>
          <Link className="boton" href="/misiones/nueva">Nueva misión</Link>
        </div>
      </div>

      <FiltrosAutomaticos className="filtros-misiones">
        <label>
          Buscar
          <input name="q" defaultValue={filtros.q ?? ''} placeholder="Código, placa, cliente, factura, guía o DEX" />
        </label>
        <label>
          Etapa
          <select name="etapa" defaultValue={filtros.etapa ?? ''}>
            <option value="">Todas</option>
            {ETAPAS.map((e) => <option key={e} value={e}>{ETIQUETA_ETAPA[e]}</option>)}
          </select>
        </label>
        <label>
          Producto
          <select name="producto" defaultValue={filtros.producto ?? ''}>
            <option value="">Todos</option>
            {productos.map((p) => <option key={p.id} value={p.id}>{p.nombre}{p.activo ? '' : ' (inactivo)'}</option>)}
          </select>
        </label>
        <label>Desde<input type="date" name="desde" defaultValue={filtros.desde ?? ''} /></label>
        <label>Hasta<input type="date" name="hasta" defaultValue={filtros.hasta ?? ''} /></label>
        <div className="acciones-filtro">
          <button className="boton">Buscar</button>
          {hayFiltros && <Link href="/misiones" className="enlace-cancelar">Limpiar</Link>}
        </div>
        <input type="hidden" name="pagina" defaultValue="" />
      </FiltrosAutomaticos>
      <p className="ayuda" style={{ marginTop: 0 }}>La etapa, el producto y las fechas se aplican al elegirlas; el texto, con Enter o «Buscar».</p>

      <p style={{ fontSize: 14, color: 'var(--gris)' }} role="status">
        {total === 0
          ? 'Sin resultados'
          : `Mostrando ${(pagina - 1) * POR_PAGINA + 1}–${(pagina - 1) * POR_PAGINA + misiones.length} de ${total} ${total === 1 ? 'misión' : 'misiones'}${hayFiltros ? ' encontradas' : ''}, de la más nueva a la más antigua`}
      </p>
      <div className="tabla-desplazable">
        <table className="tabla-tarjetas tabla-misiones">
          <thead>
            <tr><th>Misión</th><th>Cliente y destino</th><th>Entrega</th><th>Camiones y carga</th><th>Documentos</th><th>Etapa</th></tr>
          </thead>
          <tbody>
            {misiones.map((m) => {
              const camiones = m.asignaciones.filter((a) => (a.tramo ?? 1) === 1 && a.etapa !== 'cancelado');
              const entregados = camiones.filter((a) => a.etapa === 'entregado').length;
              const conPeso = camiones.filter((a) => a.toneladas_cargadas != null);
              const cargadas = conPeso.reduce((t, a) => t + Number(a.toneladas_cargadas), 0);
              const sinPeso = camiones.filter((a) => a.toneladas_cargadas == null && a.etapa !== 'programado').length;
              const abierta = m.etapa !== 'entregado' && m.etapa !== 'cancelado';
              const vence = m.entrega_comprometida;
              const atrasada = abierta && !!vence && vence < hoy;
              const ultima = ultimaSenal(m);
              const faltan = faltanDocs(m);
              const etiquetaEtapa = enTransbordo(m.asignaciones, Math.max(1, ...m.tramos.map((t) => t.numero))) ? 'En transbordo' : ETIQUETA_ETAPA[m.etapa];
              return (
                <tr key={m.id}>
                  <td>
                    <Link className="codigo-mision" href={`/misiones/${m.id}`}>{m.codigo}</Link>
                    {m.envio?.pedido
                      ? <span className="sub-dato"><Link href={`/programa/${m.envio.id}`}>{m.envio.pedido.codigo} · envío {m.envio.numero}</Link></span>
                      : <span className="sub-dato">Sin pedido</span>}
                    <span className="sub-dato" title={formatoHora(m.creado_en)}>Creada {formatoHora(m.creado_en)}</span>
                  </td>
                  <td data-etiqueta="Cliente y destino">
                    <strong className="dato-principal">{m.cliente?.razon_social ?? '—'}</strong>
                    <span className="sub-dato">→ {m.destino?.nombre} ({m.destino?.pais})</span>
                    {(m.producto?.nombre ?? m.tipo_carga ?? m.envio?.pedido?.producto) && <span className="sub-dato">{m.producto?.nombre ?? m.tipo_carga ?? m.envio?.pedido?.producto}</span>}
                  </td>
                  <td data-etiqueta="Entrega">
                    {vence ? <span className={atrasada ? 'texto-atrasado' : undefined}>{formatoFecha(vence)}</span> : '—'}
                    {atrasada && <span className="etiqueta atrasada">Atrasada</span>}
                  </td>
                  <td data-etiqueta="Camiones y carga">
                    {camiones.length === 0 ? '—' : (
                      <>
                        <span className="dato-principal">{entregados > 0 ? `${entregados} de ${camiones.length} ${camiones.length === 1 ? 'entregado' : 'entregados'}` : plural(camiones.length, 'camión', 'camiones')}</span>
                        <span className="sub-dato" title={camiones.map((a) => `${a.vehiculo?.placa ?? ''} · ${a.conductor?.nombre ?? ''}`).join('\n')}>
                          {camiones.map((a) => a.vehiculo?.placa).filter(Boolean).join(', ')}
                        </span>
                        <span className="sub-dato">
                          {conPeso.length > 0
                            ? `${formatoToneladas(cargadas)} cargadas${m.tonelaje_objetivo ? ` de ${formatoToneladas(Number(m.tonelaje_objetivo))}` : ''}`
                            : m.tonelaje_objetivo ? `Objetivo ${formatoToneladas(Number(m.tonelaje_objetivo))}` : 'Sin peso registrado'}
                        </span>
                        {sinPeso > 0 && <span className="etiqueta sin-peso">{sinPeso === 1 ? '1 sin peso' : `${sinPeso} sin peso`}</span>}
                      </>
                    )}
                  </td>
                  <td data-etiqueta="Documentos">
                    <span className="sub-dato sin-margen">Factura {m.factura || '—'}</span>
                    {faltan.length === 0
                      ? <span className="docs-ok" title="Documentos obligatorios completos">✓ Completos</span>
                      : <span className="docs-faltan" title={`Faltan: ${faltan.join(' y ')}`}>Falta {faltan.join(' y ')}</span>}
                  </td>
                  <td data-etiqueta="Etapa">
                    <span className={`etiqueta ${m.etapa}`}>{etiquetaEtapa}</span>
                    {abierta && m.etapa !== 'programado' && (
                      <span className="sub-dato" title={formatoHora(ultima)}>Señal: {ultima ? haceCuanto(ultima) : 'nunca'}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {paginas > 1 && (
        <nav className="paginacion" aria-label="Páginas de misiones" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
          {pagina > 1 ? <Link href={enlacePagina(pagina - 1)}>← Anteriores</Link> : <span />}
          <span>Página {pagina} de {paginas}</span>
          {pagina < paginas && <Link href={enlacePagina(pagina + 1)}>Siguientes →</Link>}
        </nav>
      )}
      {misiones.length === 0 && (
        <p>{hayFiltros ? 'Ninguna misión coincide con la búsqueda.' : 'Aún no hay misiones. Cree la primera con “Nueva misión”.'}</p>
      )}
    </section>
  );
}
