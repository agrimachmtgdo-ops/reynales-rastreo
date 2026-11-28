import Link from 'next/link';
import { notFound } from 'next/navigation';
import { crearClienteServidor } from '@/lib/supabase/server';
import FormularioAccion from '@/componentes/FormularioAccion';
import EditorPrograma from '@/componentes/EditorPrograma';
import { Req } from '@/componentes/Obligatorio';
import { formatoHora } from '@/lib/tipos';
import {
  CAUSAS, ESTADO_ENVIO, ESTADO_PEDIDO, formatoFecha, formatoToneladas, NOMBRE_HITO, nombreCausa, plural, resumenDespacho, sumarDias,
  toneladasVivas, type CamionDespacho, type EnvioPedido,
} from '@/lib/pedidos';
import { nombresComerciales } from '@/lib/pedidosServidor';
import { cambiarFechaCarga, cancelarEnvio, cancelarPedido, confirmarPedido, reprogramarEnvio } from '../acciones';

export const dynamic = 'force-dynamic';

interface Cambio {
  id: string; tipo: string; fecha_anterior: string | null; fecha_nueva: string | null;
  toneladas_anterior: number | null; toneladas_nueva: number | null; causa: string; nota: string | null;
  mueve_compromiso: boolean; creado_en: string; envio: { numero: number; pedido_id: string } | null;
}

const opcionesCausa = CAUSAS.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>);

export default async function PaginaPedido({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ cambiar?: string }> }) {
  const { id } = await params;
  const { cambiar } = await searchParams;
  const supabase = await crearClienteServidor();
  const [{ data: p }, { data: cambiosData }, comerciales] = await Promise.all([
    supabase.from('pedidos')
      .select('*, cliente:clientes(razon_social, nit_ruc), destino:ubicaciones(nombre, ciudad, pais), envios:programa_envios(id, numero, toneladas, fecha_carga_planificada, entrega_comprometida, entrega_vigente, estado, camiones_necesarios)')
      .eq('id', id).maybeSingle(),
    supabase.from('cambios_compromiso')
      .select('id, tipo, fecha_anterior, fecha_nueva, toneladas_anterior, toneladas_nueva, causa, nota, mueve_compromiso, creado_en, envio:programa_envios!inner(numero, pedido_id)')
      .eq('envio.pedido_id', id)
      .order('creado_en', { ascending: false }),
    nombresComerciales(),
  ]);
  if (!p) notFound();
  const [{ data: puede }, { data: programa }] = await Promise.all([
    supabase.rpc('puede_editar_pedidos', { p_cliente: p.cliente_id }),
    supabase.rpc('puede_programar', { p_cliente: p.cliente_id }),
  ]);
  const todos = [...((p.envios ?? []) as EnvioPedido[])].sort((a, b) => a.numero - b.numero);
  const planificados = todos.filter((e) => e.estado === 'planificado');
  const cambios = (cambiosData ?? []) as unknown as Cambio[];
  const abierto = p.estado === 'confirmado' || p.estado === 'en_ejecucion';
  const editable = !!puede;
  const programable = !!programa && (p.estado === 'borrador' || abierto);
  // Los planificados se editan en el editor; la tabla muestra los demás (o todos, si no puede programar).
  const envios = programable ? todos.filter((e) => e.estado !== 'planificado') : todos;
  const confirmadas = toneladasVivas(todos.filter((e) => e.estado !== 'planificado'));
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/La_Paz' });
  const ultima = todos.filter((e) => e.estado !== 'cancelado').map((e) => e.entrega_vigente).sort().at(-1);
  const cambiables = !!programa && abierto && envios.some((e) => e.estado === 'pendiente' || e.estado === 'en_curso');
  // Lo despachado por envío (camiones del tramo 1 de la misión de cada envío).
  const idsEnvio = todos.filter((e) => e.estado !== 'planificado' && e.estado !== 'cancelado').map((e) => e.id);
  const { data: camData } = idsEnvio.length
    ? await supabase.from('asignaciones').select('etapa, toneladas_cargadas, mision:misiones!inner(envio_id)').eq('tramo', 1).in('mision.envio_id', idsEnvio)
    : { data: [] };
  const camionesPorEnvio = new Map<string, CamionDespacho[]>();
  for (const c of (camData ?? []) as unknown as (CamionDespacho & { mision: { envio_id: string } | null })[]) {
    const k = c.mision?.envio_id;
    if (k) camionesPorEnvio.set(k, [...(camionesPorEnvio.get(k) ?? []), c]);
  }
  const despacho = new Map(todos.map((e) => [e.id, resumenDespacho(Number(e.toneladas), e.camiones_necesarios, camionesPorEnvio.get(e.id) ?? [])]));
  const vivos = todos.filter((e) => e.estado !== 'planificado' && e.estado !== 'cancelado');
  const pedidas = Number(p.toneladas);
  const enviadas = vivos.reduce((t, e) => t + (despacho.get(e.id)?.enviadas ?? 0), 0);
  const entregadas = vivos.reduce((t, e) => t + (despacho.get(e.id)?.entregadas ?? 0), 0);
  const sinPeso = vivos.reduce((t, e) => t + (despacho.get(e.id)?.sinPeso ?? 0), 0);
  const saldoPedido = Math.max(0, pedidas - enviadas);
  const sinProgramar = Math.max(0, pedidas - confirmadas);
  const pctDe = (t: number) => (pedidas > 0 ? Math.min(100, (t / pedidas) * 100) : 0);
  const sugerir = [hoy, p.entrega_desde, ultima && sumarDias(ultima, 1)].filter(Boolean).sort().at(-1) as string;

  return (
    <>
      <p className="migas"><Link href="/pedidos">Pedidos</Link> › {p.codigo}</p>
      <section className="tarjeta">
        <div className="cabecera-seccion">
          <h1 style={{ margin: 0 }}>{p.codigo} <span className={`etiqueta pedido-${p.estado}`}>{ESTADO_PEDIDO[p.estado] ?? p.estado}</span></h1>
          {editable && p.estado === 'borrador' && (
            <div className="botones">
              <Link className="boton secundario" href={`/pedidos/${id}/editar`}>Editar</Link>
            </div>
          )}
        </div>
        <div className="cifras-toneladas cifras-pedido">
          <div><span>Pedidas</span><strong>{formatoToneladas(pedidas)}</strong><small>{p.entrega_desde ? `Del ${formatoFecha(p.entrega_desde)} al ${formatoFecha(p.entrega_hasta)}` : `Hasta el ${formatoFecha(p.entrega_hasta)}`}</small></div>
          <div><span>Programadas</span><strong>{formatoToneladas(confirmadas)}</strong><small>{sinProgramar > 0 ? `Falta programar ${formatoToneladas(sinProgramar)}` : `${plural(vivos.length, 'envío', 'envíos')} confirmados`}</small></div>
          <div><span>Enviadas</span><strong>{formatoToneladas(enviadas)}</strong><small>{formatoToneladas(entregadas)} entregadas</small></div>
          <div className={saldoPedido > 0 ? 'cifra-saldo' : 'cifra-saldo completo'}><span>Saldo por despachar</span><strong>{formatoToneladas(saldoPedido)}</strong><small>{saldoPedido > 0 ? 'Falta salir de fábrica' : 'Todo despachado'}</small></div>
        </div>
        <div className="barra-avance barra-toneladas" role="img"
          aria-label={`${formatoToneladas(entregadas)} entregadas y ${formatoToneladas(Math.max(0, enviadas - entregadas))} en camino de ${formatoToneladas(pedidas)} pedidas`}>
          <span className="barra-entregadas" style={{ width: `${pctDe(entregadas)}%` }} />
          <span className="barra-en-camino" style={{ left: `${pctDe(entregadas)}%`, width: `${Math.min(100 - pctDe(entregadas), pctDe(Math.max(0, enviadas - entregadas)))}%` }} />
        </div>
        <ul className="leyenda-avance">
          <li><span className="muestra muestra-entregadas" aria-hidden="true" />Entregadas</li>
          <li><span className="muestra muestra-en-camino" aria-hidden="true" />En camino</li>
          <li><span className="muestra muestra-faltan" aria-hidden="true" />Por despachar</li>
        </ul>
        {sinPeso > 0 && (
          <p className="nota-estimado">{sinPeso === 1 ? '1 camión salió' : `${sinPeso} camiones salieron`} sin peso de balanza registrado: lo enviado es estimado hasta que se registre el peso.</p>
        )}

        <div className="grupos-datos">
          <div>
            <h2 className="titulo-grupo">Cliente y producto</h2>
            <dl className="lista-datos">
              <div><dt>Cliente</dt><dd>{p.cliente?.razon_social}</dd></div>
              {p.cliente?.nit_ruc && <div><dt>NIT / RUC</dt><dd>{p.cliente.nit_ruc}</dd></div>}
              <div><dt>Orden de compra</dt><dd>{p.orden_compra ?? '—'}</dd></div>
              <div><dt>Producto</dt><dd>{p.producto}</dd></div>
              <div><dt>Comercial</dt><dd>{(p.comercial_id && comerciales.get(p.comercial_id)) ?? 'Sin asignar'}</dd></div>
            </dl>
          </div>
          <div>
            <h2 className="titulo-grupo">Entrega</h2>
            <dl className="lista-datos">
              <div><dt>Incoterm</dt><dd>{p.incoterm}</dd></div>
              <div><dt>Destino</dt><dd>{p.destino?.nombre}{p.destino?.ciudad && p.destino.ciudad !== p.destino.nombre ? ` (${p.destino.ciudad})` : ''} · {p.destino?.pais}</dd></div>
              <div><dt>Plazo del cliente</dt><dd>{p.entrega_desde ? `Del ${formatoFecha(p.entrega_desde)} al ${formatoFecha(p.entrega_hasta)}` : `Hasta el ${formatoFecha(p.entrega_hasta)}`}</dd></div>
              <div><dt>Cumple a tiempo</dt><dd>{p.hito === 'carga' ? 'Si carga en fábrica' : p.hito === 'entrega' ? 'Si llega al destino' : `Se mide ${NOMBRE_HITO[p.hito] ?? p.hito}`} en la fecha comprometida</dd></div>
            </dl>
          </div>
        </div>
        <p className="meta-registro">
          {p.origen === 'excel' ? 'Importado de Excel' : 'Cargado a mano'} el {formatoHora(p.creado_en)}
          {p.confirmado_en && ` · Confirmado el ${formatoHora(p.confirmado_en)}`}
        </p>
        {p.notas && <p><strong>Notas:</strong> {p.notas}</p>}
        {p.estado === 'cancelado' && p.motivo_cancelacion && <div className="mensaje-error">Cancelado: {p.motivo_cancelacion}</div>}

        {editable && p.estado === 'borrador' && (
          <div className="aviso-confirmar">
            <p>Este pedido está en <strong>borrador</strong>. Confírmelo cuando la orden del cliente esté aceptada ({formatoToneladas(Number(p.toneladas))}, hasta el {formatoFecha(p.entrega_hasta)}). El programa de envíos se puede armar antes o después.</p>
            <FormularioAccion accion={confirmarPedido.bind(null, id)} boton="Confirmar pedido"><span /></FormularioAccion>
          </div>
        )}
      </section>

      <section className="tarjeta">
        <h2>Programa de envíos</h2>
        <p className="ayuda" style={{ marginTop: 0 }}>Cada envío es un lote de varios camiones que se entrega en una fecha.</p>
        <details className="ayuda-plegable">
          <summary>¿Qué significan las fechas?</summary>
          <ul>
            <li><strong>Carga:</strong> día en que los camiones cargan en fábrica.</li>
            <li><strong>Entrega:</strong> fecha con la que se trabaja hoy (vigente).</li>
            <li><strong>Comprometida:</strong> la fecha prometida al cliente al confirmar el programa. Solo cambia si el cliente lo pide; si se ve distinta de la entrega, el envío está atrasado o adelantado.</li>
            <li>Los envíos <strong>planificados</strong> se cambian libremente; los confirmados, con «Cambiar» y su causa.</li>
          </ul>
        </details>
        {programable && (
          <EditorPrograma
            pedido={id}
            toneladasPedido={Number(p.toneladas)}
            toneladasConfirmadas={confirmadas}
            numeroInicial={(todos.filter((e) => e.estado !== 'planificado').map((e) => e.numero).sort((a, b) => b - a).at(0) ?? 0) + 1}
            planificados={planificados.map((e) => ({ toneladas: Number(e.toneladas), entrega: e.entrega_vigente, carga: e.fecha_carga_planificada }))}
            sugerirDesde={sugerir}
            pedidoConfirmado={abierto}
          />
        )}
        {!programable && todos.length === 0 && <p>Todavía no hay envíos programados.</p>}
        {envios.length > 0 && <h3>{programable ? `Envíos confirmados (${plural(envios.length, 'envío', 'envíos')})` : 'Envíos'}</h3>}
        {envios.length > 0 && <div className="tabla-desplazable">
          <table className="tabla-tarjetas">
            <thead><tr><th>Envío</th><th className="numero">Toneladas</th><th>Carga</th><th>Entrega</th><th>Estado</th><th>Despachado</th><th><span className="solo-lector">Detalle</span></th>{cambiables && <th><span className="solo-lector">Acción</span></th>}</tr></thead>
            <tbody>{envios.map((e) => {
              const movido = !!e.entrega_comprometida && e.entrega_vigente !== e.entrega_comprometida;
              const cargaPasada = e.estado === 'pendiente' && !!e.fecha_carga_planificada && e.fecha_carga_planificada < hoy;
              return (
                <tr key={e.id} className={e.estado === 'cancelado' ? 'inactivo' : undefined}>
                  <td><span className="solo-movil">Envío </span>{e.numero}</td>
                  <td data-etiqueta="Toneladas" className="numero">{formatoToneladas(Number(e.toneladas))}</td>
                  <td data-etiqueta="Carga en fábrica">
                    {formatoFecha(e.fecha_carga_planificada)}
                    {cargaPasada && (cambiables
                      ? <Link className="etiqueta carga-pasada" href={`/pedidos/${id}?cambiar=${e.id}#cambiar-${e.id}`}>Carga pasada: corregir</Link>
                      : <span className="etiqueta carga-pasada">Carga pasada</span>)}
                  </td>
                  <td data-etiqueta="Entrega">
                    {formatoFecha(e.entrega_vigente)}
                    {movido && <span className="etiqueta reprogramado" title="La fecha de entrega es distinta de la comprometida">{e.entrega_vigente > e.entrega_comprometida! ? 'Atrasado' : 'Adelantado'}</span>}
                    {movido && <span className="sub-dato">Comprometida: {formatoFecha(e.entrega_comprometida)}</span>}
                  </td>
                  <td data-etiqueta="Estado"><span className={`etiqueta envio-${e.estado}`}>{ESTADO_ENVIO[e.estado] ?? e.estado}</span></td>
                  <td data-etiqueta="Despachado">{(() => {
                    const d = despacho.get(e.id);
                    if (!d || e.estado === 'planificado' || e.estado === 'cancelado') return '—';
                    const pctE = d.programadas > 0 ? Math.min(100, (d.enviadas / d.programadas) * 100) : 0;
                    return (
                      <div className="despachado-envio">
                        <span>{formatoToneladas(d.enviadas)} de {formatoToneladas(d.programadas)}</span>
                        <span className="mini-barra" aria-hidden="true"><span style={{ width: `${pctE}%` }} /></span>
                        {d.saldo > 0 && d.enviadas > 0 && <span className="sub-dato">Saldo {formatoToneladas(d.saldo)}</span>}
                      </div>
                    );
                  })()}</td>
                  <td>{e.estado === 'planificado' || e.estado === 'cancelado' ? null : <Link className="enlace-secundario" href={`/programa/${e.id}`}>Camiones</Link>}</td>
                  {cambiables && (
                    <td>{(e.estado === 'pendiente' || e.estado === 'en_curso') && (
                      <Link className="boton secundario" href={`/pedidos/${id}?cambiar=${e.id}#cambiar-${e.id}`}>Cambiar</Link>
                    )}</td>
                  )}
                </tr>
              );
            })}</tbody>
          </table>
        </div>}

        {cambiables && (
          <div className="acciones-envio">
            <h3>Cambiar un envío</h3>
            {envios.filter((e) => e.estado === 'pendiente' || e.estado === 'en_curso').map((e) => (
              <details key={e.id} id={`cambiar-${e.id}`} className="agregar" open={cambiar === e.id}>
                <summary>Envío {e.numero}: {formatoToneladas(Number(e.toneladas))}, entrega {formatoFecha(e.entrega_vigente)}</summary>
                <div className="rejilla-acciones">
                  <div>
                    <h4>Reprogramar</h4>
                    <FormularioAccion accion={reprogramarEnvio.bind(null, e.id, id)} boton="Guardar cambio">
                      <div className="rejilla">
                        <label>Nueva fecha de entrega <Req /><input type="date" name="fecha" required defaultValue={e.entrega_vigente} /></label>
                        <label>Toneladas <Req /><input name="toneladas" inputMode="decimal" required defaultValue={String(e.toneladas)} /></label>
                        <label>Causa <Req /><select name="causa" required defaultValue=""><option value="" disabled>Seleccione…</option>{opcionesCausa}</select></label>
                      </div>
                      <label>Nota<input name="nota" maxLength={500} placeholder="Ej. el cliente pidió mover la entrega por inventario" /></label>
                      <p className="ayuda">Solo «Pedido del cliente» cambia la fecha comprometida. Las demás causas se registran y cuentan como atraso propio.</p>
                    </FormularioAccion>
                  </div>
                  {e.estado === 'pendiente' && (
                    <div>
                      <h4>Corregir fecha de carga</h4>
                      <FormularioAccion accion={cambiarFechaCarga.bind(null, e.id, id)} boton="Guardar fecha de carga" claseBoton="boton secundario">
                        <label>Nueva fecha de carga <Req />
                          <input type="date" name="carga" required max={e.entrega_vigente} defaultValue={e.fecha_carga_planificada ?? ''} />
                        </label>
                        <label>Causa <Req /><select name="causa" required defaultValue=""><option value="" disabled>Seleccione…</option>{opcionesCausa}</select></label>
                        <label>Nota<input name="nota" maxLength={500} placeholder="Ej. error al escribir la fecha" /></label>
                        <p className="ayuda">Mueve el día de carga en fábrica y el aviso de camiones. La fecha de entrega comprometida no cambia.</p>
                      </FormularioAccion>
                    </div>
                  )}
                  <div>
                    <h4>Cancelar este envío</h4>
                    <FormularioAccion accion={cancelarEnvio.bind(null, e.id, id)} boton="Cancelar envío" claseBoton="boton peligro">
                      <label>Causa <Req /><select name="causa" required defaultValue=""><option value="" disabled>Seleccione…</option>{opcionesCausa}</select></label>
                      <label>Nota<input name="nota" maxLength={500} /></label>
                    </FormularioAccion>
                  </div>
                </div>
              </details>
            ))}
          </div>
        )}
      </section>

      <section className="tarjeta">
        <h2>Historial de cambios</h2>
        {cambios.length === 0
          ? <p className="ayuda">Sin cambios desde que se confirmó.</p>
          : (
            <div className="tabla-desplazable"><table>
              <thead><tr><th>Fecha y hora</th><th>Envío</th><th>Cambio</th><th>Causa</th><th>¿Mueve el compromiso?</th><th>Nota</th></tr></thead>
              <tbody>{cambios.map((c) => (
                <tr key={c.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatoHora(c.creado_en)}</td>
                  <td>{c.envio?.numero}</td>
                  <td>{c.tipo === 'cancelado' ? 'Cancelado' : c.tipo === 'carga' ? `Carga ${formatoFecha(c.fecha_anterior)} → ${formatoFecha(c.fecha_nueva)}` : describirCambio(c)}</td>
                  <td>{nombreCausa(c.causa)}</td>
                  <td>{c.mueve_compromiso ? 'Sí (pedido del cliente)' : 'No'}</td>
                  <td>{c.nota ?? ''}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
      </section>

      {editable && (p.estado === 'borrador' || p.estado === 'confirmado') && (
        <section className="tarjeta">
          <details className="agregar">
            <summary>Cancelar el pedido completo</summary>
            <p className="ayuda">Se cancelan el pedido y sus envíos pendientes. No se puede deshacer; si solo cambia un envío, use «Cambiar un envío».</p>
            <FormularioAccion accion={cancelarPedido.bind(null, id)} boton="Cancelar pedido" claseBoton="boton peligro">
              <label>Motivo <Req /><input name="motivo" required maxLength={500} /></label>
            </FormularioAccion>
          </details>
        </section>
      )}
    </>
  );
}

function describirCambio(c: Cambio): string {
  const partes: string[] = [];
  if (c.fecha_anterior !== c.fecha_nueva) partes.push(`Entrega ${formatoFecha(c.fecha_anterior)} → ${formatoFecha(c.fecha_nueva)}`);
  if (c.toneladas_anterior != null && c.toneladas_nueva != null && Number(c.toneladas_anterior) !== Number(c.toneladas_nueva)) {
    partes.push(`${formatoToneladas(Number(c.toneladas_anterior))} → ${formatoToneladas(Number(c.toneladas_nueva))}`);
  }
  return partes.join(' · ') || 'Reprogramado';
}
