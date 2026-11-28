'use client';
import Link from 'next/link';
import { useState, useTransition, type ChangeEvent } from 'react';
import { importarPedidos } from '@/app/(panel)/pedidos/acciones';
import { leerPedidos, type Celda, type ClienteRef, type ResultadoLectura, type UbicacionRef } from '@/lib/importarPedidos';
import { formatoFecha, formatoToneladas } from '@/lib/pedidos';

type Resultado = Awaited<ReturnType<typeof importarPedidos>>[number];

/**
 * Importación de pedidos desde Excel: lee el archivo en el navegador, muestra una vista previa
 * con los errores de cada pedido y crea en borrador solo los que están completos.
 */
export default function ImportarPedidos({ clientes, ubicaciones }: { clientes: ClienteRef[]; ubicaciones: UbicacionRef[] }) {
  const [archivo, setArchivo] = useState<string | null>(null);
  const [lectura, setLectura] = useState<ResultadoLectura | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [resultados, setResultados] = useState<Resultado[] | null>(null);
  const [pendiente, iniciar] = useTransition();

  async function alElegir(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    setResultados(null);
    setLectura(null);
    if (!f) return;
    setArchivo(f.name);
    setLeyendo(true);
    try {
      const { readSheet } = await import('read-excel-file/browser'); // se carga solo al importar
      const filas = (await readSheet(f)) as Celda[][];
      setLectura(leerPedidos(filas, clientes, ubicaciones));
    } catch {
      setLectura({ pedidos: [], filasLeidas: 0, error: 'No se pudo leer el archivo. Debe ser un Excel .xlsx (si es .xls o .csv, ábralo en Excel y use «Guardar como» .xlsx).' });
    } finally {
      setLeyendo(false);
    }
  }

  const validos = lectura?.pedidos.filter((p) => p.datos && p.errores.length === 0 && p.envios.length > 0) ?? [];
  const conErrores = (lectura?.pedidos.length ?? 0) - validos.length;

  function crear() {
    iniciar(async () => {
      const r = await importarPedidos(validos.map((p) => ({
        clave: p.clave, datos: p.datos!, envios: p.envios.map(({ toneladas, entrega, carga }) => ({ toneladas, entrega, carga })),
      })));
      setResultados(r);
    });
  }
  const resultadoDe = (clave: string) => resultados?.find((r) => r.clave === clave);
  const creados = resultados?.filter((r) => r.ok).length ?? 0;

  return (
    <>
      <section className="tarjeta">
        <ol className="pasos-importar">
          <li>Use la <a href="/plantilla-pedidos.xlsx" download>plantilla de pedidos</a> o su propia planilla: se reconocen títulos como «OC», «Cliente», «NIT», «Producto», «Destino», «Incoterm», «Toneladas» y «Fecha de entrega».</li>
          <li>Cada fila es un envío. Las filas con el mismo cliente y la misma orden de compra forman un solo pedido.</li>
          <li>El cliente y el destino deben existir en Catálogos. Los pedidos se crean en borrador para que los revise y confirme.</li>
        </ol>
        <label className="selector-excel">
          <span className="boton secundario">Elegir archivo Excel</span>
          <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={alElegir} className="solo-lector" />
          <span aria-live="polite">{leyendo ? 'Leyendo…' : archivo ?? 'Ningún archivo elegido'}</span>
        </label>
      </section>

      {lectura?.error && <div className="mensaje-error" role="alert">{lectura.error}</div>}

      {lectura && !lectura.error && (
        <section className="tarjeta">
          <h2>Vista previa</h2>
          <p role="status">
            {lectura.filasLeidas} {lectura.filasLeidas === 1 ? 'fila leída' : 'filas leídas'}: <strong>{validos.length} {validos.length === 1 ? 'pedido listo' : 'pedidos listos'}</strong>
            {conErrores > 0 && <>, <span className="docs-faltan">{conErrores} con errores</span> (corríjalos en el Excel y vuelva a elegir el archivo)</>}.
          </p>
          <div className="tabla-desplazable"><table className="tabla-importar">
            <thead><tr><th>Filas</th><th>Cliente</th><th>OC</th><th>Producto</th><th>Destino</th><th>Envíos</th><th>Resultado</th></tr></thead>
            <tbody>{lectura.pedidos.map((p) => {
              const r = resultadoDe(p.clave);
              const ok = p.errores.length === 0 && p.envios.length > 0;
              return (
                <tr key={p.clave} className={ok ? undefined : 'fila-error'}>
                  <td>{p.filas.join(', ')}</td>
                  <td>{p.clienteNombre}</td>
                  <td>{p.datos?.orden_compra ?? '—'}</td>
                  <td>{p.datos?.producto ?? ''}</td>
                  <td>{p.datos ? `${p.datos.incoterm} ${p.destinoNombre}` : p.destinoNombre}</td>
                  <td>
                    {p.envios.map((e) => <div key={e.fila}>{formatoToneladas(e.toneladas)} · {formatoFecha(e.entrega)}</div>)}
                  </td>
                  <td>
                    {!ok && <ul className="lista-errores">{p.errores.map((m) => <li key={m}>{m}</li>)}</ul>}
                    {ok && !r && 'Listo para crear'}
                    {r && (r.ok
                      ? <Link href={`/pedidos/${r.id}`}>✓ {r.mensaje}</Link>
                      : <span className="docs-faltan">{r.mensaje}</span>)}
                  </td>
                </tr>
              );
            })}</tbody>
          </table></div>
          {!resultados && (
            <button className="boton" onClick={crear} disabled={pendiente || validos.length === 0}>
              {pendiente ? 'Creando…' : `Crear ${validos.length} ${validos.length === 1 ? 'pedido' : 'pedidos'} en borrador`}
            </button>
          )}
          {resultados && (
            <div role="status" className={creados === resultados.length ? 'mensaje-ok' : 'mensaje-error'}>
              Se crearon {creados} de {resultados.length} pedidos en borrador. <Link href="/pedidos?estado=borrador">Ver borradores para confirmarlos</Link>.
            </div>
          )}
        </section>
      )}
    </>
  );
}
