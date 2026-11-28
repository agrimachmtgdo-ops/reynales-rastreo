import Link from 'next/link';
import { notFound } from 'next/navigation';
import { crearClienteServidor } from '@/lib/supabase/server';
import FormularioAccion from '@/componentes/FormularioAccion';
import EditorPrograma from '@/componentes/EditorPrograma';
import { Req } from '@/componentes/Obligatorio';
import { formatoHora } from '@/lib/tipos';
import {
  CAUSAS, ESTADO_ENVIO, ESTADO_PEDIDO, formatoFecha, formatoToneladas, NOMBRE_HITO, nombreCausa, plural, sumarDias, toneladasVivas,
  type EnvioPedido,
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
      .select('*, cliente:clientes(razon_social, nit_ruc), destino:ubicaciones(nombre, ciudad, pais), envios:programa_envios(id, numero, toneladas, fecha_carga_planificada, entrega_comprometida, entrega_vigente, estado)')
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
        <dl className="datos-pedido">
          <div><dt>Cliente</dt><dd>{p.cliente?.razon_social}{p.cliente?.nit_ruc ? ` · ${p.cliente.nit_ruc}` : ''}</dd></div>
          <div><dt>Orden de compra</dt><dd>{p.orden_compra ?? '—'}</dd></div>
          <div><dt>Producto</dt><dd>{p.producto}</dd></div>
          <div><dt>Entrega</dt><dd>{p.incoterm} {p.destino?.nombre}{p.destino?.ciudad ? ` (${p.destino.ciudad})` : ''} · {p.destino?.pais}</dd></div>
          <div><dt>Cumplimiento</dt><dd>Se mide {NOMBRE_HITO[p.hito] ?? p.hito}</dd></div>
          <div><dt>Toneladas pedidas</dt><dd>{formatoToneladas(Number(p.toneladas))}</dd></div>
          <div><dt>Plazo del cliente</dt><dd>{p.entrega_desde ? `Del ${formatoFecha(p.entrega_desde)} al ${formatoFecha(p.entrega_hasta)}` : `Hasta el ${formatoFecha(p.entrega_hasta)}`}</dd></div>
          <div><dt>Comercial</dt><dd>{(p.comercial_id && comerciales.get(p.comercial_id)) ?? '—'}</dd></div>
          <div><dt>Origen</dt><dd>{p.origen === 'excel' ? 'Importado de Excel' : 'Cargado a mano'} el {formatoHora(p.creado_en)}</dd></div>
          {p.confirmado_en && <div><dt>Confirmado</dt><dd>{formatoHora(p.confirmado_en)}</dd></div>}
        </dl>
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
        <p className="ayuda" style={{ marginTop: 0 }}>
          Cada envío es un lote que se entrega en una fecha y puede llevar varios camiones. Los envíos planificados se cambian libremente; al confirmar el programa, su fecha queda como compromiso con el cliente.
          «Comprometida» solo cambia si el cliente pide el cambio; «Vigente» es la fecha con la que se trabaja hoy.
        </p>
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
            <thead><tr><th>N°</th><th>Toneladas</th><th>Carga en fábrica</th><th>Entrega comprometida</th><th>Entrega vigente</th><th>Estado</th><th>Camiones</th>{cambiables && <th><span className="solo-lector">Acción</span></th>}</tr></thead>
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
                  <td data-etiqueta="Entrega comprometida">{e.entrega_comprometida ? formatoFecha(e.entrega_comprometida) : <span className="ayuda-campo">Al confirmar</span>}</td>
                  <td data-etiqueta="Entrega vigente">
                    {formatoFecha(e.entrega_vigente)}
                    {movido && <span className="etiqueta reprogramado" title="La fecha vigente es distinta de la comprometida">{e.entrega_vigente > e.entrega_comprometida! ? 'Atrasado' : 'Adelantado'}</span>}
                  </td>
                  <td data-etiqueta="Estado"><span className={`etiqueta envio-${e.estado}`}>{ESTADO_ENVIO[e.estado] ?? e.estado}</span></td>
                  <td data-etiqueta="Camiones">{e.estado === 'planificado' || e.estado === 'cancelado' ? '—' : <Link href={`/programa/${e.id}`}>Camiones y misión</Link>}</td>
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
