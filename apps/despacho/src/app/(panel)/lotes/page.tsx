import Link from 'next/link';
import { ETIQUETA_ETAPA, type Etapa } from '@reynales/shared';
import { buscarLote } from '@/lib/lotesServidor';
import { cantidadLote, formatoKg } from '@/lib/lotes';
import { formatoHora } from '@/lib/tipos';

export const dynamic = 'force-dynamic';

/** Búsqueda por lote: a qué camiones, misiones y clientes fue un lote de producción. */
export default async function PaginaLotes({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = '' } = await searchParams;
  const texto = q.trim();
  const { filas, error } = texto.length >= 2 ? await buscarLote(texto) : { filas: [], error: null };
  const lotes = new Set(filas.map((f) => f.lote));
  const clientes = new Set(filas.map((f) => f.cliente));
  const totalKg = filas.reduce((t, f) => t + Number(f.kg), 0);

  return (
    <section className="tarjeta">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>Lotes</h1>
        {filas.length > 0 && (
          <a className="boton secundario" href={`/lotes/exportar?q=${encodeURIComponent(texto)}`}>Exportar a Excel (CSV)</a>
        )}
      </div>
      <p className="ayuda" style={{ marginTop: 0 }}>
        Escriba un número de lote (o su comienzo) para ver en qué camiones salió, a qué clientes fue y si ya se entregó.
      </p>
      <form className="busqueda-lote" method="get">
        <label>
          N.º de lote
          <input name="q" defaultValue={texto} placeholder="Ej. L-2611" autoComplete="off" required minLength={2} />
        </label>
        <button className="boton">Buscar</button>
        {texto && <Link href="/lotes" className="enlace-cancelar">Limpiar</Link>}
      </form>

      {error && <div className="mensaje-error">{error}</div>}
      {texto.length >= 2 && !error && (
        <p style={{ fontSize: 14, color: 'var(--gris)' }} role="status">
          {filas.length === 0
            ? `No hay camiones con lotes que empiecen con «${texto.toUpperCase()}».`
            : `${lotes.size === 1 ? '1 lote' : `${lotes.size} lotes`} en ${filas.length === 1 ? '1 camión' : `${filas.length} camiones`}, ${clientes.size === 1 ? '1 cliente' : `${clientes.size} clientes`}, ${formatoKg(totalKg)} en total.`}
        </p>
      )}

      {filas.length > 0 && (
        <div className="tabla-desplazable">
          <table className="tabla-tarjetas tabla-misiones">
            <thead>
              <tr>
                <th>Lote</th><th>Producto</th><th>Cantidad</th><th>Cliente y destino</th><th>Misión</th><th>Camión</th><th>Salida</th><th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={`${f.asignacion_id}-${f.lote}-${f.presentacion}`}>
                  <td data-etiqueta="Lote">
                    <strong>{f.lote}</strong>
                    {f.fecha_produccion && <div className="detalle">Prod. {new Date(`${f.fecha_produccion}T12:00:00`).toLocaleDateString('es-BO')}</div>}
                  </td>
                  <td data-etiqueta="Producto">{f.producto}</td>
                  <td data-etiqueta="Cantidad">{cantidadLote(f)}</td>
                  <td data-etiqueta="Cliente">{f.cliente}<div className="detalle">{f.destino} ({f.pais_cliente})</div></td>
                  <td data-etiqueta="Misión">
                    <Link href={`/misiones/${f.mision_id}`}>{f.mision}</Link>
                    {f.pedido && f.pedido_id && <div className="detalle">Pedido <Link href={`/pedidos/${f.pedido_id}`}>{f.pedido}</Link></div>}
                    {f.factura && <div className="detalle">Factura {f.factura}</div>}
                  </td>
                  <td data-etiqueta="Camión">{f.placa ?? '—'}<div className="detalle">{f.transportista ?? ''}</div></td>
                  <td data-etiqueta="Salida">{f.salida ? formatoHora(f.salida) : 'aún no sale'}</td>
                  <td data-etiqueta="Estado">
                    {f.entrega
                      ? <>Entregado {formatoHora(f.entrega)}</>
                      : <span className={`etiqueta ${f.etapa}`}>{ETIQUETA_ETAPA[f.etapa as Etapa] ?? f.etapa}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
