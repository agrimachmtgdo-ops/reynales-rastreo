import Link from 'next/link';
import { ETAPAS, ETIQUETA_ETAPA } from '@reynales/shared';
import { buscarMisiones, type FiltrosMisiones } from '@/lib/misiones';
import { formatoHora } from '@/lib/tipos';

export const dynamic = 'force-dynamic';

export default async function PaginaMisiones({ searchParams }: { searchParams: Promise<FiltrosMisiones> }) {
  const filtros = await searchParams;
  const { filas: misiones, error } = await buscarMisiones(filtros);
  if (error) return <div className="mensaje-error">{error}</div>;

  const hayFiltros = !!(filtros.q || filtros.etapa || filtros.desde || filtros.hasta);
  const parametros = new URLSearchParams(
    Object.entries(filtros).filter(([, v]) => typeof v === 'string' && v !== '') as [string, string][],
  ).toString();

  return (
    <section className="tarjeta">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>Misiones</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a className="boton secundario" href={`/misiones/exportar${parametros ? `?${parametros}` : ''}`}>Exportar a Excel (CSV)</a>
          <Link className="boton" href="/misiones/nueva">Nueva misión</Link>
        </div>
      </div>

      <form className="filtros-misiones" role="search" method="get">
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
      </form>

      <p style={{ fontSize: 14, color: 'var(--gris)' }}>
        {misiones.length} {misiones.length === 1 ? 'misión' : 'misiones'}{hayFiltros ? ' encontradas' : ' (las más recientes)'}
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr><th>Código</th><th>Cliente</th><th>Destino</th><th>Factura</th><th>Camiones</th><th>Etapa</th><th>Creada</th></tr>
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
                <td><span className={`etiqueta ${m.etapa}`}>{ETIQUETA_ETAPA[m.etapa]}</span></td>
                <td>{formatoHora(m.creado_en)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {misiones.length === 0 && (
        <p>{hayFiltros ? 'Ninguna misión coincide con la búsqueda.' : 'Aún no hay misiones. Cree la primera con “Nueva misión”.'}</p>
      )}
    </section>
  );
}
