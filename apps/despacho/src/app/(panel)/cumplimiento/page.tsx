import Link from 'next/link';
import { crearClienteServidor } from '@/lib/supabase/server';
import { cargarCumplimiento, cargarTransportistas } from '@/lib/cumplimientoServidor';
import { cargarReporte } from '@/lib/reportesServidor';
import {
  causasDeFalla, cumplimientoPorCliente, fichasCumplimiento, INCOTERMS, leerFiltrosCumplimiento, motivoFalla, otifPorSemana,
  parametrosCumplimiento, resumirCumplimiento, textoCausa, type EnvioCumplimiento, type FiltrosCumplimiento,
} from '@/lib/cumplimiento';
import { fichasTransportistas, formatoHoras, formatoPct, formatoTn } from '@/lib/reportes';
import { formatoFecha } from '@/lib/pedidos';
import BotonImprimir from '@/componentes/BotonImprimir';
import FiltrosAutomaticos from '@/componentes/FiltrosAutomaticos';
import FormularioAccion from '@/componentes/FormularioAccion';
import { BarraMeta, GraficoBarras, GraficoColumnas } from '@/componentes/GraficosReporte';
import { fijarAjustesCumplimiento } from './acciones';

export const dynamic = 'force-dynamic';

const fechaCorta = (f: string) => new Date(`${f}T12:00:00Z`).toLocaleDateString('es-BO', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const de = (a: number, b: number) => (b > 0 ? `${a} de ${b}` : 'sin datos');

function Cifra({ titulo, valor, detalle }: { titulo: string; valor: string; detalle?: string }) {
  return (
    <div className="cifra">
      <span className="cifra-titulo">{titulo}</span>
      <span className="cifra-valor">{valor}</span>
      {detalle && <span className="cifra-detalle">{detalle}</span>}
    </div>
  );
}

/** Cumplimiento de entregas (OTIF) y de transportistas, para gerencia. */
export default async function PaginaCumplimiento({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const filtros = leerFiltrosCumplimiento(await searchParams);
  const supabase = await crearClienteServidor();
  const [{ data: clientes }, { data: perfil }] = await Promise.all([
    supabase.from('clientes').select('id, razon_social').order('razon_social'),
    supabase.rpc('perfil_actual'),
  ]);
  const esComercial = perfil === 'comercial';
  const vista = esComercial ? 'envios' : filtros.vista;
  const hayFiltros = !!(filtros.cliente || filtros.incoterm);

  return (
    <>
      <section className="tarjeta">
        <div className="titulo-reporte">
          <div>
            <h1 style={{ margin: 0 }}>Cumplimiento</h1>
            <p className="ayuda" style={{ margin: '4px 0 0' }}>
              {vista === 'envios'
                ? `Envíos con entrega comprometida del ${fechaCorta(filtros.desde)} al ${fechaCorta(filtros.hasta)}: ¿llegaron a tiempo y completos (OTIF)?`
                : `Camiones pedidos para envíos con carga del ${fechaCorta(filtros.desde)} al ${fechaCorta(filtros.hasta)}.`}
            </p>
          </div>
          <div className="acciones-reporte no-imprimir">
            <a className="boton secundario" href={`/cumplimiento/exportar?${parametrosCumplimiento({ ...filtros, vista })}`}>Exportar a Excel (CSV)</a>
            <BotonImprimir />
          </div>
        </div>

        {!esComercial && (
          <nav className="pestanas no-imprimir" aria-label="Vistas de cumplimiento" style={{ marginTop: 12 }}>
            {(['envios', 'transportistas'] as const).map((v) => (
              <Link key={v} href={`/cumplimiento?${parametrosCumplimiento(filtros, { vista: v })}`}
                className={v === vista ? 'activa' : undefined} aria-current={v === vista ? 'page' : undefined}>
                {v === 'envios' ? 'Envíos (OTIF)' : 'Transportistas'}
              </Link>
            ))}
          </nav>
        )}

        <FiltrosAutomaticos className="filtros-reporte no-imprimir">
          {vista === 'transportistas' && <input type="hidden" name="vista" value="transportistas" />}
          <label>{vista === 'envios' ? 'Comprometidos desde' : 'Carga desde'}<input type="date" name="desde" defaultValue={filtros.desde} /></label>
          <label>Hasta<input type="date" name="hasta" defaultValue={filtros.hasta} /></label>
          {vista === 'envios' && (
            <>
              <label>Cliente
                <select name="cliente" defaultValue={filtros.cliente ?? ''}>
                  <option value="">Todos</option>
                  {(clientes ?? []).map((c) => <option key={c.id} value={c.id}>{c.razon_social}</option>)}
                </select>
              </label>
              <label>Incoterm
                <select name="incoterm" defaultValue={filtros.incoterm ?? ''}>
                  <option value="">Todos</option>
                  {INCOTERMS.map((i) => <option key={i} value={i}>{i}</option>)}
                </select>
              </label>
              <div className="acciones-filtro">
                <button className="boton">Aplicar</button>
                {hayFiltros && <Link href={`/cumplimiento?${parametrosCumplimiento({ ...filtros, cliente: undefined, incoterm: undefined })}`} className="enlace-cancelar">Quitar filtros</Link>}
              </div>
            </>
          )}
        </FiltrosAutomaticos>
      </section>

      {vista === 'envios' ? <VistaEnvios filtros={filtros} esAdmin={perfil === 'administrador'} /> : <VistaTransportistas filtros={filtros} />}
    </>
  );
}

async function VistaEnvios({ filtros, esAdmin }: { filtros: FiltrosCumplimiento; esAdmin: boolean }) {
  const { datos, error } = await cargarCumplimiento(filtros);
  if (error || !datos) return <section className="tarjeta mensaje-error">No se pudo calcular el cumplimiento: {error}</section>;
  const { ajustes, envios } = datos;
  const r = resumirCumplimiento(envios);
  const meta = Number(ajustes.meta_pct) / 100;
  const semanas = otifPorSemana(envios, filtros);
  const clientes = cumplimientoPorCliente(envios);
  const causas = causasDeFalla(envios);
  const fallas = envios.filter((e) => e.otif === false);

  return (
    <>
      <section className="tarjeta">
        {datos.solo_propios && <p className="ayuda" style={{ marginTop: 0 }}>Ve solo los clientes a su cargo.</p>}
        <div className="cifras" style={{ marginTop: 0 }}>
          <Cifra titulo="OTIF" valor={formatoPct(r.pctOtif)} detalle={`${de(r.otif, r.conOtif)} envíos · meta ${ajustes.meta_pct} %`} />
          <Cifra titulo="A tiempo" valor={formatoPct(r.pctATiempo)} detalle={`${de(r.aTiempo, r.medidos)} · tolerancia ${ajustes.tolerancia_dias} ${Number(ajustes.tolerancia_dias) === 1 ? 'día' : 'días'}`} />
          <Cifra titulo="Completo" valor={formatoPct(r.pctCompleto)} detalle={`${de(r.completos, r.conPeso)} con peso · ±${ajustes.tolerancia_pct} %`} />
          <Cifra titulo="Envíos medidos" valor={String(r.medidos)}
            detalle={`${r.vencidos} ${r.vencidos === 1 ? 'vencido' : 'vencidos'} sin entregar · ${r.cancelados} ${r.cancelados === 1 ? 'cancelado' : 'cancelados'} por causa propia`} />
          <Cifra titulo="Atraso promedio" valor={r.diasAtrasoPromedio === null ? '—' : `${r.diasAtrasoPromedio.toFixed(1).replace('.', ',')} días`} detalle="de los envíos que llegaron tarde" />
          <Cifra titulo="Toneladas faltantes" valor={`${formatoTn(r.toneladasFaltantes)} TN`} detalle="en envíos incompletos" />
          {(() => {
            const entregados = envios.filter((e) => e.hito === 'entrega' && e.medicion === 'medido');
            const confirmados = entregados.filter((e) => e.recibido_confirmado).length;
            return entregados.length > 0 && envios.some((e) => e.recibido_confirmado !== undefined) ? (
              <Cifra titulo="Recepción confirmada" valor={`${confirmados} de ${entregados.length}`}
                detalle="envíos entregados con prueba de entrega; los demás se miden con el peso de fábrica" />
            ) : null;
          })()}
        </div>
        <p className="ayuda" style={{ marginBottom: 0 }}>
          Se mide contra la fecha y las toneladas comprometidas con el cliente; solo los cambios que pidió el cliente las mueven.
          Un envío vencido sin entregar ya cuenta como atrasado. Los que aún no vencen no se cuentan.
        </p>
      </section>

      {envios.length === 0 ? (
        <section className="tarjeta"><p>No hay envíos con entrega comprometida vencida o cumplida en este período{filtros.cliente || filtros.incoterm ? ' con estos filtros' : ''}.</p></section>
      ) : (
        <>
          <section className="tarjeta rejilla-graficos">
            <div>
              <BarraMeta titulo="OTIF del período" valor={r.pctOtif} meta={meta} rotulo="OTIF"
                detalle={r.conOtif ? `${r.otif} de ${r.conOtif} envíos a tiempo y completos` : 'Aún no hay envíos con resultado.'} />
            </div>
            <div>
              <GraficoColumnas titulo="OTIF por semana (% de envíos)" unidad="%"
                datos={semanas.map((s) => ({ etiqueta: fechaCorta(s.semana), valor: s.pct === null ? 0 : Math.round(s.pct * 100), detalle: `${s.otif} de ${s.medidos} envíos` }))} />
              <details className="tabla-grafico">
                <summary>Ver tabla</summary>
                <table><thead><tr><th>Semana del</th><th>Envíos medidos</th><th>OTIF</th></tr></thead>
                  <tbody>{semanas.map((s) => <tr key={s.semana}><td>{fechaCorta(s.semana)}</td><td>{s.medidos}</td><td>{formatoPct(s.pct)}</td></tr>)}</tbody></table>
              </details>
            </div>
            {causas.length > 0 && (
              <div>
                <GraficoBarras titulo="Causas de las fallas" unidad="envíos"
                  datos={causas.map((c) => ({ etiqueta: c.nombre, valor: c.fallas, detalle: formatoPct(c.pct) }))} />
                <details className="tabla-grafico">
                  <summary>Ver tabla</summary>
                  <table><thead><tr><th>Causa</th><th>Envíos</th><th>% de las fallas</th></tr></thead>
                    <tbody>{causas.map((c) => <tr key={c.causa}><td>{c.nombre}</td><td>{c.fallas}</td><td>{formatoPct(c.pct)}</td></tr>)}</tbody></table>
                </details>
              </div>
            )}
          </section>

          <section className="tarjeta">
            <h2>Por cliente</h2>
            <div className="tabla-desplazable"><table className="tabla-tarjetas">
              <thead><tr><th>Cliente</th><th>Envíos</th><th>OTIF</th><th>A tiempo</th><th>Completo</th><th>Atraso promedio</th><th>TN faltantes</th></tr></thead>
              <tbody>{clientes.map((c) => (
                <tr key={c.cliente_id}>
                  <td><Link href={`/cumplimiento?${parametrosCumplimiento({ ...filtros, cliente: c.cliente_id })}`}>{c.cliente}</Link></td>
                  <td data-etiqueta="Envíos">{c.medidos}</td>
                  <td data-etiqueta="OTIF" className={c.pctOtif !== null && c.pctOtif < meta ? 'docs-faltan' : undefined}>{formatoPct(c.pctOtif)}</td>
                  <td data-etiqueta="A tiempo">{formatoPct(c.pctATiempo)}</td>
                  <td data-etiqueta="Completo">{formatoPct(c.pctCompleto)}</td>
                  <td data-etiqueta="Atraso promedio">{c.diasAtrasoPromedio === null ? '—' : `${c.diasAtrasoPromedio.toFixed(1).replace('.', ',')} días`}</td>
                  <td data-etiqueta="TN faltantes">{formatoTn(c.toneladasFaltantes)}</td>
                </tr>
              ))}</tbody>
            </table></div>
          </section>

          <section className="tarjeta">
            <h2>Envíos que no cumplieron ({fallas.length})</h2>
            {fallas.length === 0 ? <p>Todos los envíos medidos llegaron a tiempo y completos.</p> : <TablaEnvios envios={fallas} />}
            {envios.length > fallas.length && (
              <details className="agregar" style={{ marginTop: 12 }}>
                <summary>Ver todos los envíos medidos ({envios.length})</summary>
                <TablaEnvios envios={envios} />
              </details>
            )}
          </section>
        </>
      )}

      {esAdmin && (
        <section className="tarjeta no-imprimir">
          <details>
            <summary>Ajustes de cumplimiento (tolerancias y meta)</summary>
            <FormularioAccion accion={fijarAjustesCumplimiento} boton="Guardar ajustes">
              <div className="rejilla">
                <label>Días de tolerancia para «a tiempo»<input name="dias" type="number" min={0} max={10} inputMode="numeric" defaultValue={ajustes.tolerancia_dias} required /></label>
                <label>Tolerancia de toneladas (± %)<input name="pct" inputMode="decimal" defaultValue={ajustes.tolerancia_pct} required /></label>
                <label>Meta de OTIF (%)<input name="meta" inputMode="decimal" defaultValue={ajustes.meta_pct} required /></label>
                <label>Tolerancia de llegada a fábrica (min)<input name="min" type="number" min={0} max={600} inputMode="numeric" defaultValue={ajustes.tolerancia_min} required /></label>
              </div>
            </FormularioAccion>
          </details>
        </section>
      )}
    </>
  );
}

function TablaEnvios({ envios }: { envios: EnvioCumplimiento[] }) {
  return (
    <div className="tabla-desplazable"><table className="tabla-tarjetas">
      <thead><tr><th>Envío</th><th>Cliente</th><th>Entrega</th><th>Comprometida</th><th>Real</th><th>Resultado</th><th className="numero">TN comprometidas</th><th className="numero">TN reales</th><th>Causa</th><th>Misión</th></tr></thead>
      <tbody>{envios.map((e) => (
        <tr key={e.envio_id}>
          <td><Link href={`/pedidos/${e.pedido_id}`}>{e.pedido_codigo}</Link> · envío {e.numero}</td>
          <td data-etiqueta="Cliente">{e.cliente}</td>
          <td data-etiqueta="Entrega">{e.incoterm} {e.destino ?? ''}{e.hito === 'carga' ? ' (se mide la carga)' : ''}</td>
          <td data-etiqueta="Comprometida">{formatoFecha(e.comprometida)}</td>
          <td data-etiqueta="Real">{formatoFecha(e.fecha_real)}{e.embarque ? ` · embarque ${formatoFecha(e.embarque)}` : ''}</td>
          <td data-etiqueta="Resultado">{e.otif ? '✓ A tiempo y completo' : e.otif === null && e.a_tiempo ? 'A tiempo · falta el peso' : <span className="docs-faltan">{motivoFalla(e)}</span>}</td>
          <td data-etiqueta="TN comprometidas" className="numero">{formatoTn(Number(e.toneladas_comprometidas))}</td>
          <td data-etiqueta="TN reales" className="numero">
            {e.toneladas_reales === null ? '—' : formatoTn(Number(e.toneladas_reales))}
            {e.toneladas_reales !== null && e.hito === 'entrega' && e.medicion === 'medido' && e.recibido_confirmado !== undefined && (
              <span className="ayuda-campo" style={{ display: 'block' }}>{e.recibido_confirmado ? 'recibidas' : 'de fábrica · sin confirmar'}</span>
            )}
          </td>
          <td data-etiqueta="Causa">{e.otif ? '—' : textoCausa(e.causa)}</td>
          <td data-etiqueta="Misión">{e.mision_id ? <Link href={`/misiones/${e.mision_id}`}>{e.mision_codigo}</Link> : '—'}</td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}

async function VistaTransportistas({ filtros }: { filtros: FiltrosCumplimiento }) {
  const supabase = await crearClienteServidor();
  const [{ lista, toleranciaMin, error }, viajes, { data: rechazosData }, { data: mermasData, error: errorMermas }] = await Promise.all([
    cargarTransportistas(filtros),
    cargarReporte({ desde: filtros.desde, hasta: filtros.hasta }),
    supabase.rpc('rechazos_inspeccion', { p_desde: filtros.desde, p_hasta: filtros.hasta }),
    supabase.rpc('mermas_entrega', { p_desde: filtros.desde, p_hasta: filtros.hasta }),
  ]);
  // Faltantes en la entrega (null si la base aún no tiene la prueba de entrega).
  const mermas = errorMermas ? null : ((mermasData ?? []) as {
    transportista_id: string; transportista: string; destino: string; entregas: number; con_novedad: number;
    kg_despachados: number | null; kg_recibidos: number | null; merma_kg: number | null;
  }[]);
  const rechazos = new Map(((rechazosData ?? []) as { transportista_id: string; camiones_inspeccionados: number; camiones_rechazados: number; rechazos: number }[])
    .map((r) => [r.transportista_id, r]));
  if (error) return <section className="tarjeta mensaje-error">No se pudo calcular el cumplimiento de transportistas: {error}</section>;
  const fichas = fichasCumplimiento(lista);
  const porViaje = new Map(fichasTransportistas(viajes.filas).map((f) => [f.id, f]));

  return (
    <section className="tarjeta">
      <h2 style={{ marginTop: 0 }}>Transportistas</h2>
      <p className="ayuda">
        De peor a mejor presentación. Confirmación = camiones confirmados sobre los pedidos que respondieron. Presentación = camiones
        que llegaron a fábrica sobre los cargados con placa. Puntual = llegó hasta {toleranciaMin} min después de la hora de presentación.
        Viajes y señal GPS: misiones entregadas en el período (de Reportes). Rechazos: camiones que almacén rechazó en la inspección
        (piso sucio, olores, lona rota…) sobre los inspeccionados en el período.
      </p>
      {fichas.length === 0 ? <p>No se pidieron camiones para envíos con carga en este período.</p> : (
        <>
          <div className="tabla-desplazable"><table className="tabla-tarjetas">
            <thead><tr>
              <th>Transportista</th><th>Camiones pedidos</th><th>Confirmación</th><th>Sin respuesta</th><th>Presentación</th>
              <th>Puntualidad</th><th>Ausencias</th><th>Viajes</th><th>Duración (mediana)</th><th>Señal GPS</th><th>Rechazos en inspección</th>
            </tr></thead>
            <tbody>{fichas.map((t) => {
              const v = porViaje.get(t.transportista_id);
              return (
                <tr key={t.transportista_id}>
                  <td>{t.transportista}</td>
                  <td data-etiqueta="Camiones pedidos">{t.pedidos}</td>
                  <td data-etiqueta="Confirmación">{formatoPct(t.pctConfirmacion)} <span className="ayuda-campo" style={{ display: 'inline' }}>({de(t.confirmados, t.respondidos)})</span></td>
                  <td data-etiqueta="Sin respuesta">{t.sin_respuesta}</td>
                  <td data-etiqueta="Presentación" className={t.pctPresentacion !== null && t.pctPresentacion < 1 ? 'docs-faltan' : undefined}>
                    {formatoPct(t.pctPresentacion)} <span className="ayuda-campo" style={{ display: 'inline' }}>({de(t.llegaron, t.asignados)})</span>
                  </td>
                  <td data-etiqueta="Puntualidad">{formatoPct(t.pctPuntualidad)} <span className="ayuda-campo" style={{ display: 'inline' }}>({de(t.puntuales, t.con_hora)})</span></td>
                  <td data-etiqueta="Ausencias" className={t.ausencias > 0 ? 'docs-faltan' : undefined}>{t.ausencias}</td>
                  <td data-etiqueta="Viajes">{v?.viajes ?? 0}</td>
                  <td data-etiqueta="Duración (mediana)">{formatoHoras(v?.duracionMediana)}</td>
                  <td data-etiqueta="Señal GPS">{formatoPct(v?.pctSenal)}</td>
                  {(() => {
                    const r = rechazos.get(t.transportista_id);
                    return (
                      <td data-etiqueta="Rechazos en inspección" className={r && r.camiones_rechazados > 0 ? 'docs-faltan' : undefined}>
                        {r ? <>{r.camiones_rechazados} <span className="ayuda-campo" style={{ display: 'inline' }}>(de {r.camiones_inspeccionados} inspeccionados)</span></> : '—'}
                      </td>
                    );
                  })()}
                </tr>
              );
            })}</tbody>
          </table></div>

          {mermas && (
            <>
              <h3 style={{ marginTop: 24 }}>Faltantes en la entrega</h3>
              <p className="ayuda">
                Según las pruebas de entrega registradas en el período (chofer o logística): lo recibido por el cliente contra lo despachado.
              </p>
              {mermas.length === 0 ? <p>No hay pruebas de entrega en este período.</p> : (
                <div className="tabla-desplazable"><table className="tabla-tarjetas tabla-mermas">
                  <thead><tr><th>Transportista</th><th>Destino</th><th>Entregas</th><th>Con novedad</th><th className="numero">Kg despachados</th><th className="numero">Kg recibidos</th><th className="numero">Faltante</th></tr></thead>
                  <tbody>{mermas.map((m) => {
                    const pct = m.kg_despachados ? (Number(m.merma_kg ?? 0) / Number(m.kg_despachados)) * 100 : null;
                    return (
                      <tr key={`${m.transportista_id}-${m.destino}`}>
                        <td>{m.transportista}</td>
                        <td data-etiqueta="Destino">{m.destino}</td>
                        <td data-etiqueta="Entregas">{m.entregas}</td>
                        <td data-etiqueta="Con novedad" className={m.con_novedad > 0 ? 'docs-faltan' : undefined}>{m.con_novedad}</td>
                        <td data-etiqueta="Kg despachados" className="numero">{m.kg_despachados == null ? '—' : Number(m.kg_despachados).toLocaleString('es-BO')}</td>
                        <td data-etiqueta="Kg recibidos" className="numero">{m.kg_recibidos == null ? '—' : Number(m.kg_recibidos).toLocaleString('es-BO')}</td>
                        <td data-etiqueta="Faltante" className={`numero${Number(m.merma_kg ?? 0) > 0 ? ' merma' : ''}`}>
                          {m.merma_kg == null ? '—' : `${Number(m.merma_kg).toLocaleString('es-BO')} kg`}
                          {pct != null && Number(m.merma_kg) > 0 && ` (${pct.toFixed(2).replace('.', ',')} %)`}
                        </td>
                      </tr>
                    );
                  })}</tbody>
                </table></div>
              )}
            </>
          )}

          {fichas.some((t) => t.detalle_ausencias.length > 0) && (
            <>
              <h3 style={{ marginTop: 24 }}>Camiones que no se presentaron</h3>
              <div className="tabla-desplazable"><table className="tabla-tarjetas">
                <thead><tr><th>Transportista</th><th>Carga</th><th>Envío</th><th>Placa</th><th>Chofer</th><th>Causa</th></tr></thead>
                <tbody>{fichas.flatMap((t) => t.detalle_ausencias.map((a, i) => (
                  <tr key={`${t.transportista_id}-${i}`}>
                    <td>{t.transportista}</td>
                    <td data-etiqueta="Carga">{formatoFecha(a.carga)}</td>
                    <td data-etiqueta="Envío">{a.pedido_codigo} · envío {a.numero}</td>
                    <td data-etiqueta="Placa">{a.placa}</td>
                    <td data-etiqueta="Chofer">{a.chofer}</td>
                    <td data-etiqueta="Causa">{a.causa}</td>
                  </tr>
                )))}</tbody>
              </table></div>
            </>
          )}
        </>
      )}
    </section>
  );
}
