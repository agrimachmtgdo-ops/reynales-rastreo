import Link from 'next/link';
import { ETAPAS, ETIQUETA_ETAPA } from '@reynales/shared';
import { buscarMisiones, POR_PAGINA, type FiltrosMisiones } from '@/lib/misiones';
import { formatoHora, haceCuanto } from '@/lib/tipos';
import FiltrosAutomaticos from '@/componentes/FiltrosAutomaticos';

export const dynamic = 'force-dynamic';

export default async function PaginaMisiones({ searchParams }: { searchParams: Promise<FiltrosMisiones> }) {
  const filtros = await searchParams;
  const pagina = Math.max(1, Math.floor(Number(filtros.pagina) || 1));
  const { filas: misiones, total, error } = await buscarMisiones(filtros, POR_PAGINA, (pagina - 1) * POR_PAGINA);
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  if (error) return <div className="mensaje-error">{error}</div>;

  const hayFiltros = !!(filtros.q || filtros.etapa || filtros.desde || filtros.hasta);
  const soloFiltros = Object.entries(filtros).filter(([k, v]) => k !== 'pagina' && typeof v === 'string' && v !== '') as [string, string][];
  const parametros = new URLSearchParams(soloFiltros).toString();
  const enlacePagina = (n: number) => `/misiones?${new URLSearchParams([...soloFiltros, ['pagina', String(n)]]).toString()}`;
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
        <label>Desde<input type="date" name="desde" defaultValue={filtros.desde ?? ''} /></label>
        <label>Hasta<input type="date" name="hasta" defaultValue={filtros.hasta ?? ''} /></label>
        <div className="acciones-filtro">
          <button className="boton">Buscar</button>
          {hayFiltros && <Link href="/misiones" className="enlace-cancelar">Limpiar</Link>}
        </div>
        <input type="hidden" name="pagina" defaultValue="" />
      </FiltrosAutomaticos>
      <p className="ayuda" style={{ marginTop: 0 }}>La etapa y las fechas se aplican al elegirlas; el texto, con Enter o «Buscar».</p>

      <p style={{ fontSize: 14, color: 'var(--gris)' }} role="status">
        {total === 0
          ? 'Sin resultados'
          : `Mostrando ${(pagina - 1) * POR_PAGINA + 1}–${(pagina - 1) * POR_PAGINA + misiones.length} de ${total} ${total === 1 ? 'misión' : 'misiones'}${hayFiltros ? ' encontradas' : ''}, de la más nueva a la más antigua`}
      </p>
      <div className="tabla-desplazable">
        <table>
          <thead>
            <tr><th>Código</th><th>Cliente</th><th>Destino</th><th>Factura</th><th>Camiones</th><th>Chofer</th><th>Etapa</th><th>Última señal</th><th>Creada</th></tr>
          </thead>
          <tbody>
            {misiones.map((m) => (
              <tr key={m.id}>
                <td><Link href={`/misiones/${m.id}`}>{m.codigo}</Link></td>
                <td>{m.cliente?.razon_social}</td>
                <td>{m.destino?.nombre} ({m.destino?.pais})</td>
                <td>{m.factura}</td>
                <td title={m.asignaciones.map((a) => a.vehiculo?.placa).join(', ')}>
                  {m.asignaciones.map((a) => a.vehiculo?.placa).filter(Boolean).join(', ') || '—'}
                </td>
                <td>{m.asignaciones.map((a) => a.conductor?.nombre).filter(Boolean).join(', ') || '—'}</td>
                <td><span className={`etiqueta ${m.etapa}`}>{ETIQUETA_ETAPA[m.etapa]}</span></td>
                <td title={formatoHora(ultimaSenal(m))} style={{ whiteSpace: 'nowrap' }}>{ultimaSenal(m) ? haceCuanto(ultimaSenal(m)) : '—'}</td>
                <td>{formatoHora(m.creado_en)}</td>
              </tr>
            ))}
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
