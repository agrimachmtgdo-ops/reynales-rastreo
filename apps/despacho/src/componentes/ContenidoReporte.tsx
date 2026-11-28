import Link from 'next/link';
import {
  aParametros, entregasPorSemana, fichasTransportistas, formatoHoras, formatoPct, formatoTn, mesAnterior,
  META_PUNTUALIDAD, periodoAnterior, type FilaReporte, type FiltrosReporte, resumir, SENAL_MINIMA, tiempoPorTramo, tiempos, textoMotivo, toneladasPorCliente, variacion,
} from '@/lib/reportes';
import { formatoHora } from '@/lib/tipos';
import BotonImprimir from '@/componentes/BotonImprimir';
import FiltrosAutomaticos from '@/componentes/FiltrosAutomaticos';
import { BarraMeta, BarraPartes, GraficoBarras, GraficoColumnas } from '@/componentes/GraficosReporte';

const fechaCorta = (f: string) => new Date(`${f}T12:00:00Z`).toLocaleDateString('es-BO', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** Número grande con su comparación contra el período anterior. */
function Cifra({ titulo, valor, detalle, cambio, ayuda }: { titulo: string; valor: string; detalle?: string; cambio?: string | null; ayuda?: string }) {
  return (
    <div className="cifra">
      <span className="cifra-titulo">{titulo}</span>
      <span className="cifra-valor">{valor}</span>
      {detalle && <span className="cifra-detalle">{detalle}</span>}
      {cambio !== undefined && <span className="cifra-detalle">{cambio ? `${cambio} vs. período anterior` : 'sin dato del período anterior'}</span>}
      {ayuda && <span className="cifra-detalle">{ayuda}</span>}
    </div>
  );
}

/** Contenido del reporte (separado de la carga de datos). */
export default function ContenidoReporte({ filtros, filas, filasAnteriores, clientes, transportistas }: {
  filtros: FiltrosReporte; filas: FilaReporte[]; filasAnteriores: FilaReporte[];
  clientes: { id: string; razon_social: string }[]; transportistas: { id: string; razon_social: string }[];
}) {
  const anterior = periodoAnterior(filtros);
  const r = resumir(filas);
  const ra = resumir(filasAnteriores);
  const semanas = entregasPorSemana(filas, filtros);
  const porCliente = toneladasPorCliente(filas);
  const porTramo = tiempoPorTramo(filas);
  const fichas = fichasTransportistas(filas);
  const mes = mesAnterior();
  const parametros = aParametros(filtros);
  const hayFiltros = !!(filtros.cliente || filtros.pais || filtros.transportista);
  const puntualidad = r.conCompromiso > 0 ? r.aTiempo / r.conCompromiso : null;

  return (
    <>
      <section className="tarjeta">
        <div className="titulo-reporte">
          <div>
            <h1 style={{ margin: 0 }}>Reporte de entregas</h1>
            <p className="ayuda" style={{ margin: '4px 0 0' }}>
              Misiones entregadas del {fechaCorta(filtros.desde)} al {fechaCorta(filtros.hasta)} (por fecha de entrega, hora de Bolivia).
              Se compara con el {fechaCorta(anterior.desde)} – {fechaCorta(anterior.hasta)}.
            </p>
          </div>
          <div className="acciones-reporte no-imprimir">
            <Link className="boton secundario" href={`/reportes?desde=${mes.desde}&hasta=${mes.hasta}`}>Reporte del mes ({mes.nombre})</Link>
            <a className="boton secundario" href={`/reportes/exportar?${parametros}`}>Exportar a Excel (CSV)</a>
            <BotonImprimir />
          </div>
        </div>

        <FiltrosAutomaticos className="filtros-reporte no-imprimir">
          <label>Entregadas desde<input type="date" name="desde" defaultValue={filtros.desde} /></label>
          <label>Hasta<input type="date" name="hasta" defaultValue={filtros.hasta} /></label>
          <label>
            Cliente
            <select name="cliente" defaultValue={filtros.cliente ?? ''}>
              <option value="">Todos</option>
              {(clientes ?? []).map((c) => <option key={c.id} value={c.id}>{c.razon_social}</option>)}
            </select>
          </label>
          <label>
            País de destino
            <select name="pais" defaultValue={filtros.pais ?? ''}>
              <option value="">Bolivia y Perú</option>
              <option value="BO">Bolivia</option>
              <option value="PE">Perú</option>
            </select>
          </label>
          <label>
            Transportista
            <select name="transportista" defaultValue={filtros.transportista ?? ''}>
              <option value="">Todos</option>
              {(transportistas ?? []).map((t) => <option key={t.id} value={t.id}>{t.razon_social}</option>)}
            </select>
          </label>
          <div className="acciones-filtro">
            <button className="boton">Aplicar</button>
            {hayFiltros && <Link href={`/reportes?desde=${filtros.desde}&hasta=${filtros.hasta}`} className="enlace-cancelar">Quitar filtros</Link>}
          </div>
        </FiltrosAutomaticos>
        <p className="ayuda no-imprimir" style={{ marginTop: 0 }}>
          Las fechas se aplican al elegirlas; cliente, país y transportista, con «Aplicar». El enlace de esta página guarda los filtros: puede copiarlo y compartirlo.
        </p>

        <div className="cifras">
          <Cifra titulo="Entregas" valor={String(r.entregas)} cambio={variacion(r.entregas, ra.entregas)} />
          <Cifra titulo="Toneladas despachadas" valor={`${formatoTn(r.toneladas)} TN`} detalle="pesadas en fábrica" cambio={variacion(r.toneladas, ra.toneladas)} />
          <Cifra titulo="Duración del viaje" valor={formatoHoras(r.viajeMediana)} detalle={`mediana · peor 10 %: ${formatoHoras(r.viajePeor10)}`}
            cambio={variacion(r.viajeMediana, ra.viajeMediana)} />
          <Cifra titulo="Espera en el transbordo" valor={formatoHoras(r.esperaTransbordoMediana)}
            detalle={`mediana · peor 10 %: ${formatoHoras(r.esperaTransbordoPeor10)}`} cambio={variacion(r.esperaTransbordoMediana, ra.esperaTransbordoMediana)} />
          <Cifra titulo="Espera en frontera" valor={formatoHoras(r.fronteraMediana)} detalle={`mediana · peor 10 %: ${formatoHoras(r.fronteraPeor10)}`}
            cambio={variacion(r.fronteraMediana, ra.fronteraMediana)} />
          <Cifra titulo="Entregas a tiempo" valor={formatoPct(puntualidad)}
            detalle={r.conCompromiso ? `${r.aTiempo} de ${r.conCompromiso} con fecha comprometida` : 'ninguna misión tiene «Entrega comprometida»'} />
          <Cifra titulo="Documentos completos" valor={`${r.docsCompletos} de ${r.entregas}`} ayuda="factura; y DEX si va a Perú" />
          <Cifra titulo="Con incidencias" valor={`${r.conIncidencias} de ${r.entregas}`} ayuda="alertas o emergencias en el viaje" />
        </div>
      </section>

      {filas.length === 0 ? (
        <section className="tarjeta"><p>No hay misiones entregadas en este período{hayFiltros ? ' con estos filtros' : ''}.</p></section>
      ) : (
        <>
          <section className="tarjeta rejilla-graficos">
            <div>
              <GraficoColumnas titulo="Entregas por semana" unidad="entregas"
                datos={semanas.map((s) => ({ etiqueta: fechaCorta(s.semana), valor: s.entregas, detalle: `${formatoTn(s.toneladas)} TN` }))} />
              <details className="tabla-grafico">
                <summary>Ver tabla</summary>
                <table><thead><tr><th>Semana del</th><th>Entregas</th><th>Toneladas</th></tr></thead>
                  <tbody>{semanas.map((s) => <tr key={s.semana}><td>{fechaCorta(s.semana)}</td><td>{s.entregas}</td><td>{formatoTn(s.toneladas)}</td></tr>)}</tbody></table>
              </details>
            </div>
            <div>
              <GraficoBarras titulo="Toneladas por cliente" unidad="TN"
                datos={porCliente.map((c) => ({ etiqueta: c.cliente, valor: c.toneladas, detalle: `${c.entregas} entregas` }))} />
              <details className="tabla-grafico">
                <summary>Ver tabla</summary>
                <table><thead><tr><th>Cliente</th><th>Entregas</th><th>Toneladas</th></tr></thead>
                  <tbody>{porCliente.map((c) => <tr key={c.cliente}><td>{c.cliente}</td><td>{c.entregas}</td><td>{formatoTn(c.toneladas)}</td></tr>)}</tbody></table>
              </details>
            </div>
            <div>
              <BarraPartes titulo={`Tiempo por tramo en viajes con transbordo (mediana de ${porTramo.viajes} ${porTramo.viajes === 1 ? 'viaje' : 'viajes'})`} partes={porTramo.partes} />
            </div>
            <div>
              <BarraMeta titulo="Puntualidad" valor={puntualidad} meta={META_PUNTUALIDAD}
                detalle={r.conCompromiso ? `${r.aTiempo} de ${r.conCompromiso} misiones con fecha comprometida` : 'Para medirla, cargue «Entrega comprometida» al crear o editar la misión.'} />
            </div>
          </section>

          <section className="tarjeta">
            <h2>Por transportista</h2>
            <p className="ayuda">
              Base para el incentivo y la penalidad. Un viaje es un camión en una misión. «Señal» es el % del recorrido con GPS
              (un corte de más de 15 minutos cuenta como sin señal); «señal baja» son los viajes con menos del {Math.round(SENAL_MINIMA * 100)} %.
            </p>
            <div className="tabla-desplazable"><table>
              <thead><tr>
                <th>Transportista</th><th>Viajes</th><th>Toneladas</th><th>Duración (mediana)</th><th>Con incidencias</th>
                <th>Señal</th><th>Horas sin señal</th><th>Viajes con señal baja</th><th>Etapas: chofer / sistema / despacho</th>
              </tr></thead>
              <tbody>
                {fichas.map((t) => (
                  <tr key={t.id}>
                    <td><Link href={`/reportes?${aParametros({ ...filtros, transportista: t.id })}`}>{t.nombre}</Link></td>
                    <td>{t.viajes}</td><td>{formatoTn(t.toneladas)}</td><td>{formatoHoras(t.duracionMediana)}</td><td>{t.conIncidencias}</td>
                    <td className={t.pctSenal !== null && t.pctSenal < SENAL_MINIMA ? 'docs-faltan' : undefined}>{formatoPct(t.pctSenal)}</td>
                    <td>{formatoHoras(t.horasSinSenal)}</td><td>{t.viajesSenalBaja}</td>
                    <td>{t.etapasChofer} / {t.etapasSistema} / {t.etapasDespacho}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </section>

          <section className="tarjeta">
            <h2>Detalle por misión ({filas.length})</h2>
            <div className="tabla-desplazable"><table className="tabla-reporte">
              <thead><tr>
                <th>Misión</th><th>Cliente</th><th>Destino</th><th>Salida de fábrica</th><th>Entrega</th><th>Duración</th>
                <th>Espera transbordo</th><th>Espera frontera</th><th>TN</th><th>Camiones</th><th>Docs</th><th>Puntualidad</th><th>Incidencias</th>
              </tr></thead>
              <tbody>
                {filas.map((f) => {
                  const t = tiempos(f);
                  return (
                    <tr key={f.id}>
                      <td><Link href={`/misiones/${f.id}`}>{f.codigo}</Link></td>
                      <td>{f.cliente}</td>
                      <td>{f.destino} ({f.pais})</td>
                      <td>{formatoHora(f.salida)}</td>
                      <td>{formatoHora(f.entrega)}</td>
                      <td>{formatoHoras(t.viaje)}</td>
                      <td>{f.transbordo ? formatoHoras(t.esperaTransbordo) : 'sin transbordo'}</td>
                      <td>{formatoHoras(t.frontera)}</td>
                      <td>{formatoTn(f.toneladas)}</td>
                      <td>{f.camiones.map((c) => `${c.placa} (${c.transportista}${f.transbordo ? `, tramo ${c.tramo}` : ''})`).join(' · ')}</td>
                      <td>{f.docs_completos ? '✓ Completos' : <span className="docs-faltan">Incompletos</span>}</td>
                      <td>{t.retraso === null ? '—' : t.retraso === 0 ? '✓ A tiempo' : <span className="docs-faltan">{formatoHoras(t.retraso)} tarde</span>}</td>
                      <td>{f.incidencias === 0 ? 'Ninguna' : f.motivos.map(textoMotivo).join(', ')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          </section>
        </>
      )}
    </>
  );
}
