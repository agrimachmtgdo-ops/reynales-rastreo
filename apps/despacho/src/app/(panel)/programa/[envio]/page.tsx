import Link from 'next/link';
import { notFound } from 'next/navigation';
import { crearClienteServidor } from '@/lib/supabase/server';
import BotonCopiar from '@/componentes/BotonCopiar';
import FormularioAccion from '@/componentes/FormularioAccion';
import { Req } from '@/componentes/Obligatorio';
import { enlaceWhatsApp } from '@/lib/tipos';
import { ESTADO_ENVIO, formatoFecha, formatoToneladas, plural, resumenDespacho } from '@/lib/pedidos';
import {
  ESTADO_SOLICITUD, fechaCarga, fechaHoraBolivia, formatoCosto, formatoTarifa, NOMBRE_SEMAFORO, semaforo,
  textoWhatsApp, valorFechaHora, type FilaPrograma, type Solicitud,
} from '@/lib/programa';
import {
  agregarCamion, anularSolicitud, crearMisionEnvio, guardarRequerimiento, pedirCamiones, registrarAusencia,
  registrarEmbarque, registrarLlegada, registrarPeso, responderSolicitud,
} from '../acciones';

export const dynamic = 'force-dynamic';

interface Camion {
  id: string; etapa: string; solicitud_id: string | null; llegada_fabrica: string | null; ausencia_causa: string | null;
  transportista_id: string; toneladas_cargadas: number | null;
  vehiculo: { placa: string } | null; conductor: { nombre: string; telefono: string | null } | null;
}
interface Opcion { id: string; transportista_id: string; nombre: string }

const ETAPA_CAMION: Record<string, string> = {
  programado: 'Programado', cargado: 'Cargado', en_ruta: 'En ruta', en_frontera: 'En frontera',
  cruzo_frontera: 'Cruzó frontera', entregado: 'Entregado', cancelado: 'Anulado',
};

/** Un envío del programa: requerimiento de camiones, pedidos por transportista, misión y camiones. */
export default async function PaginaEnvio({ params }: { params: Promise<{ envio: string }> }) {
  const { envio } = await params;
  const supabase = await crearClienteServidor();
  const [{ data: filas }, { data: dias }, { data: perfil }] = await Promise.all([
    supabase.rpc('resumen_programa', { p_desde: null, p_hasta: null, p_envio: envio }),
    supabase.rpc('dias_anticipacion_camiones'),
    supabase.rpc('perfil_actual'),
  ]);
  const f = ((filas ?? []) as FilaPrograma[])[0];
  if (!f) notFound();
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/La_Paz' });
  const luz = semaforo(f, hoy, Number(dias ?? 4));
  const esLogistica = perfil === 'administrador' || perfil === 'logistica';
  const abierto = f.estado === 'pendiente' || f.estado === 'en_curso';
  const gestiona = esLogistica && abierto;

  const [{ data: sol }, { data: trans }, { data: cond }, { data: veh }, { data: fab }, { data: cam }] = await Promise.all([
    esLogistica
      ? supabase.from('solicitudes_camiones').select('*, transportista:transportistas(razon_social, telefono, contacto)').eq('envio_id', envio).order('creado_en')
      : Promise.resolve({ data: [] }),
    gestiona ? supabase.from('transportistas').select('id, razon_social').order('razon_social') : Promise.resolve({ data: [] }),
    gestiona ? supabase.from('conductores').select('id, transportista_id, nombre').eq('activo', true).order('nombre') : Promise.resolve({ data: [] }),
    gestiona ? supabase.from('vehiculos').select('id, transportista_id, placa').order('placa') : Promise.resolve({ data: [] }),
    gestiona && !f.mision_id ? supabase.from('ubicaciones').select('id, nombre').eq('tipo', 'fabrica').order('nombre') : Promise.resolve({ data: [] }),
    f.mision_id
      ? supabase.from('asignaciones')
        .select('id, etapa, solicitud_id, llegada_fabrica, ausencia_causa, transportista_id, toneladas_cargadas, vehiculo:vehiculos(placa), conductor:conductores(nombre, telefono)')
        .eq('mision_id', f.mision_id).eq('tramo', 1).order('creado_en')
      : Promise.resolve({ data: [] }),
  ]);
  const solicitudes = (sol ?? []) as unknown as Solicitud[];
  const transportistas = (trans ?? []) as { id: string; razon_social: string }[];
  const conductores = (cond ?? []) as Opcion[];
  const vehiculos = ((veh ?? []) as { id: string; transportista_id: string; placa: string }[]).map((v) => ({ ...v, nombre: v.placa }));
  const fabricas = (fab ?? []) as { id: string; nombre: string }[];
  const camiones = (cam ?? []) as unknown as Camion[];
  const origen = fabricas.length === 1 ? fabricas[0]!.nombre : null;
  const abiertas = new Set(solicitudes.filter((s) => s.estado === 'pedido' || s.estado === 'confirmado').map((s) => s.transportista_id));
  const faltan = Math.max(0, f.camiones_necesarios - f.camiones_confirmados);
  const sinPedir = Math.max(0, f.camiones_necesarios - f.camiones_pedidos);
  const necesarios = Math.max(1, f.camiones_necesarios);
  const pctConfirmados = Math.min(100, Math.round((f.camiones_confirmados / necesarios) * 100));
  const pctPlaca = Math.min(100, Math.round((f.camiones_asignados / necesarios) * 100));

  // Toneladas: programadas, enviadas (salieron de fábrica), entregadas y saldo por despachar.
  const { programadas, porCamion, enviadas, entregadas, enCamino, saldo, camionesSaldo, sinPeso, camionesSalidos } =
    resumenDespacho(Number(f.toneladas), f.camiones_necesarios, camiones);
  const pct = (t: number) => (programadas > 0 ? Math.min(100, (t / programadas) * 100) : 0);
  const pctEntregadas = pct(entregadas);
  const pctEnCamino = Math.min(100 - pctEntregadas, pct(enCamino));

  return (
    <>
      <p className="migas"><Link href="/programa">Programa</Link> › {f.pedido_codigo} · envío {f.numero}</p>
      <section className="tarjeta">
        <div className="cabecera-seccion">
          <h1 style={{ margin: 0 }}>
            {f.pedido_codigo} · envío {f.numero} <span className={`etiqueta envio-${f.estado}`}>{ESTADO_ENVIO[f.estado] ?? f.estado}</span>
          </h1>
          <span className={`semaforo luz-${luz}`}><span className={`luz luz-${luz}`} aria-hidden="true" />{NOMBRE_SEMAFORO[luz]}</span>
        </div>
        <dl className="datos-pedido">
          <div><dt>Cliente</dt><dd>{f.cliente}</dd></div>
          <div><dt>Producto</dt><dd>{f.producto}{f.orden_compra ? ` · OC ${f.orden_compra}` : ''}</dd></div>
          <div><dt>Entrega</dt><dd>{f.incoterm} {f.destino} · {f.destino_pais}</dd></div>
          <div><dt>Toneladas</dt><dd>{formatoToneladas(Number(f.toneladas))}</dd></div>
          <div><dt>Carga en fábrica</dt><dd>{formatoFecha(fechaCarga(f))}{f.fecha_carga ? '' : ' (sin fecha de carga: se usa la de entrega)'}</dd></div>
          <div><dt>Entrega vigente</dt><dd>{formatoFecha(f.entrega_vigente)}{f.entrega_comprometida && f.entrega_comprometida !== f.entrega_vigente ? ` (comprometida ${formatoFecha(f.entrega_comprometida)})` : ''}</dd></div>
          <div><dt>Presentación en fábrica</dt><dd>{fechaHoraBolivia(f.presentacion)}</dd></div>
          <div><dt>Costo del flete</dt><dd>{formatoCosto(f.costo)}</dd></div>
          {f.incoterm === 'FOB' && <div><dt>Embarque (puerto)</dt><dd>{formatoFecha(f.embarque_fecha)}</dd></div>}
          <div><dt>Misión</dt><dd>{f.mision_id ? <Link href={`/misiones/${f.mision_id}`}>{f.mision_codigo}</Link> : 'Aún no creada'}</dd></div>
        </dl>

        <div className="avance-camiones">
          <div className="avance-cabecera">
            <span className="avance-titulo">Camiones</span>
            <span className="avance-cifra"><strong>{f.camiones_confirmados}</strong> de {f.camiones_necesarios} confirmados</span>
          </div>
          <div className="barra-avance" role="progressbar" aria-label="Camiones confirmados"
            aria-valuemin={0} aria-valuemax={f.camiones_necesarios} aria-valuenow={f.camiones_confirmados}>
            <span className="barra-confirmados" style={{ width: `${pctConfirmados}%` }} />
            <span className="barra-placa" style={{ width: `${pctPlaca}%` }} />
          </div>
          <ul className="leyenda-avance">
            <li><span className="muestra muestra-placa" aria-hidden="true" />{plural(f.camiones_asignados, 'camión', 'camiones')} con placa y chofer</li>
            <li><span className="muestra muestra-confirmados" aria-hidden="true" />{plural(f.camiones_confirmados, 'confirmado', 'confirmados')} por transportistas</li>
            <li><span className="muestra muestra-faltan" aria-hidden="true" />{faltan > 0 ? `faltan ${faltan}` : 'completo'}</li>
          </ul>
        </div>

        <div className="avance-toneladas">
          <span className="avance-titulo">Toneladas</span>
          <div className="cifras-toneladas">
            <div><span>Programadas</span><strong>{formatoToneladas(programadas)}</strong></div>
            <div><span>Enviadas</span><strong>{formatoToneladas(enviadas)}</strong><small>{plural(camionesSalidos, 'camión salió', 'camiones salieron')} de fábrica</small></div>
            <div><span>Entregadas</span><strong>{formatoToneladas(entregadas)}</strong>{enCamino > 0 && <small>{formatoToneladas(enCamino)} en camino</small>}</div>
            <div className={saldo > 0 ? 'cifra-saldo' : 'cifra-saldo completo'}>
              <span>Saldo por despachar</span><strong>{formatoToneladas(saldo)}</strong>
              <small>{saldo > 0 ? `≈ ${plural(camionesSaldo, 'camión', 'camiones')} más` : 'Todo despachado'}</small>
            </div>
          </div>
          <div className="barra-avance barra-toneladas" role="img"
            aria-label={`${formatoToneladas(entregadas)} entregadas, ${formatoToneladas(enCamino)} en camino y ${formatoToneladas(saldo)} por despachar de ${formatoToneladas(programadas)}`}>
            <span className="barra-entregadas" style={{ width: `${pctEntregadas}%` }} />
            <span className="barra-en-camino" style={{ left: `${pctEntregadas}%`, width: `${pctEnCamino}%` }} />
          </div>
          <ul className="leyenda-avance">
            <li><span className="muestra muestra-entregadas" aria-hidden="true" />Entregadas</li>
            <li><span className="muestra muestra-en-camino" aria-hidden="true" />En camino</li>
            <li><span className="muestra muestra-faltan" aria-hidden="true" />Por despachar</li>
          </ul>
          {sinPeso > 0 && (
            <p className="nota-estimado">
              {sinPeso === 1 ? '1 camión no tiene' : `${sinPeso} camiones no tienen`} peso de balanza registrado: se {sinPeso === 1 ? `estima en ${formatoToneladas(porCamion)}` : `estiman en ${formatoToneladas(porCamion)} cada uno`}.
              Registre el peso en la misión para que el saldo sea exacto.
            </p>
          )}
        </div>

        {abierto && faltan > 0 && (
          <div className="aviso-faltan" role="status">
            <strong>Faltan {plural(faltan, 'camión', 'camiones')} por confirmar.</strong>{' '}
            {gestiona
              ? sinPedir > 0
                ? <>Pida {plural(sinPedir, 'camión más', 'camiones más')} a un transportista. <a href="#pedir">Pedir camiones</a></>
                : <>Ya se pidieron todos: registre la respuesta de cada transportista en el paso 2.</>
              : <>Logística está gestionando los camiones que faltan.</>}
          </div>
        )}

        <p className="pie-resumen"><Link className="enlace-secundario" href={`/pedidos/${f.pedido_id}`}>Ver el pedido completo</Link></p>
        {!esLogistica && <p className="ayuda">Logística pide y asigna los camiones. Aquí ve el avance y el costo total del flete.</p>}
      </section>

      {gestiona && (
        <section className="tarjeta">
          <h2>1. Requerimiento</h2>
          <FormularioAccion accion={guardarRequerimiento.bind(null, envio)} boton="Guardar requerimiento" claseBoton="boton secundario">
            <div className="rejilla rejilla-corta">
              <label>Camiones necesarios
                <input name="camiones" type="number" min={1} max={60} inputMode="numeric" defaultValue={f.camiones_necesarios} />
                <span className="ayuda-campo">Estimado: 29 t por camión. Cámbielo si hace falta.</span>
              </label>
              <label>Presentación en fábrica
                <input name="presentacion" type="datetime-local" defaultValue={valorFechaHora(f.presentacion) || `${fechaCarga(f)}T07:00`} />
                <span className="ayuda-campo">Día y hora (Bolivia). Cada pedido a un transportista la puede cambiar.</span>
              </label>
            </div>
          </FormularioAccion>
        </section>
      )}

      {esLogistica && (
        <section className="tarjeta" id="pedidos">
          <h2>{gestiona ? '2. Pedidos a transportistas' : 'Pedidos a transportistas'}</h2>
          {solicitudes.length === 0 && <p>Todavía no se pidieron camiones para este envío.</p>}
          {solicitudes.map((s) => {
            const propios = camiones.filter((c) => c.solicitud_id === s.id);
            const vivos = propios.filter((c) => c.etapa !== 'cancelado');
            const libres = s.estado === 'confirmado' ? (s.camiones_confirmados ?? 0) - vivos.length : 0;
            return (
              <article key={s.id} className={`solicitud solicitud-${s.estado}`}>
                <div className="cabecera-seccion">
                  <h3 style={{ margin: 0 }}>{s.transportista?.razon_social}</h3>
                  <span className={`etiqueta solicitud-${s.estado}`}>{ESTADO_SOLICITUD[s.estado]}</span>
                </div>
                <dl className="datos-solicitud">
                  <div><dt>Pedidos</dt><dd>{plural(s.camiones_pedidos, 'camión', 'camiones')}</dd></div>
                  <div><dt>Confirmó</dt><dd>{s.camiones_confirmados != null ? s.camiones_confirmados : 'Sin respuesta'}</dd></div>
                  <div><dt>Tarifa</dt><dd>{formatoTarifa(s)}</dd></div>
                  {s.presentacion && <div><dt>Presentación</dt><dd>{fechaHoraBolivia(s.presentacion)}</dd></div>}
                  {s.transportista?.telefono && (
                    <div><dt>Contacto</dt><dd>
                      {s.transportista.contacto ? `${s.transportista.contacto} · ` : ''}
                      <a href={`tel:${s.transportista.telefono.replace(/[^0-9+]/g, '')}`}>{s.transportista.telefono}</a>
                    </dd></div>
                  )}
                  {s.nota && <div className="dato-ancho"><dt>Nota</dt><dd>{s.nota}</dd></div>}
                </dl>

                {gestiona && s.estado !== 'anulado' && (
                  <div className="rejilla-acciones panel-acciones">
                    {s.estado === 'pedido' && (
                      <div>
                        <h4>Mensaje para WhatsApp</h4>
                        <pre className="mensaje-whatsapp">{textoWhatsApp(f, s, origen)}</pre>
                        <div className="botones-mensaje">
                          <BotonCopiar texto={textoWhatsApp(f, s, origen)} />
                          {(() => {
                            const wa = enlaceWhatsApp(s.transportista?.telefono, textoWhatsApp(f, s, origen));
                            return wa
                              ? <a className="enlace-secundario" target="_blank" rel="noreferrer" href={wa}>Abrir WhatsApp</a>
                              : <span className="ayuda-campo">Sin teléfono con código de país: copie el mensaje.</span>;
                          })()}
                        </div>
                      </div>
                    )}
                    <div>
                      <h4>{s.estado === 'pedido' ? 'Respuesta del transportista' : 'Corregir la respuesta'}</h4>
                      <FormularioAccion accion={responderSolicitud.bind(null, s.id, envio)} boton="Registrar respuesta" claseBoton="boton secundario">
                        <label>Camiones que confirma <Req />
                          <input name="confirmados" type="number" min={0} max={s.camiones_pedidos} inputMode="numeric" required
                            defaultValue={s.camiones_confirmados ?? s.camiones_pedidos} />
                          <span className="ayuda-campo">0 si no puede.</span>
                        </label>
                        <label>Tarifa acordada ({s.moneda} por {s.tarifa_tipo})
                          <input name="tarifa" inputMode="decimal" defaultValue={s.tarifa ?? ''} />
                        </label>
                      </FormularioAccion>
                      {vivos.length === 0 && (
                        <FormularioAccion accion={anularSolicitud.bind(null, s.id, envio)} boton="Anular este pedido" claseBoton="enlace-boton"><span /></FormularioAccion>
                      )}
                    </div>
                  </div>
                )}

                {(propios.length > 0 || (gestiona && s.estado === 'confirmado')) && (
                  <div className="camiones-solicitud">
                    <h4>Camiones ({vivos.length} de {s.camiones_confirmados ?? 0})</h4>
                    {propios.length > 0 && (
                      <div className="tabla-desplazable"><table>
                        <thead><tr><th>Placa</th><th>Chofer</th><th>Estado</th><th>Llegada a fábrica</th><th>Peso de balanza</th>{gestiona && <th><span className="solo-lector">Acciones</span></th>}</tr></thead>
                        <tbody>{propios.map((c) => (
                          <tr key={c.id} className={c.etapa === 'cancelado' ? 'inactivo' : undefined}>
                            <td>{c.vehiculo?.placa}</td>
                            <td>{c.conductor?.nombre}</td>
                            <td>
                              <span className={`etiqueta ${c.etapa}`}>{c.ausencia_causa ? 'No se presentó' : ETAPA_CAMION[c.etapa] ?? c.etapa}</span>
                              {c.ausencia_causa && <div className="ayuda-campo">{c.ausencia_causa}</div>}
                            </td>
                            <td>{c.llegada_fabrica ? fechaHoraBolivia(c.llegada_fabrica) : '—'}</td>
                            <td>
                              {c.etapa === 'cancelado' ? '—' : (
                                <>
                                  {c.toneladas_cargadas != null
                                    ? <strong>{formatoToneladas(Number(c.toneladas_cargadas))}</strong>
                                    : c.etapa !== 'programado' && <span className="etiqueta sin-peso">Salió sin peso</span>}
                                  {esLogistica && (
                                    <FormularioAccion accion={registrarPeso.bind(null, c.id, envio)} boton={c.toneladas_cargadas != null ? 'Corregir' : 'Guardar peso'}
                                      claseBoton="boton secundario boton-chico" clase="peso-en-linea">
                                      <label><span className="solo-lector">Peso de balanza en toneladas</span>
                                        <input name="peso" inputMode="decimal" placeholder="t" defaultValue={c.toneladas_cargadas ?? ''} size={6} />
                                      </label>
                                    </FormularioAccion>
                                  )}
                                </>
                              )}
                            </td>
                            {gestiona && (
                              <td>
                                {c.etapa === 'programado' && !c.llegada_fabrica && (
                                  <div className="acciones-camion">
                                    <FormularioAccion accion={registrarLlegada.bind(null, c.id, envio)} boton="Llegó a fábrica" claseBoton="boton secundario"><span /></FormularioAccion>
                                    <details>
                                      <summary>No se presentó</summary>
                                      <FormularioAccion accion={registrarAusencia.bind(null, c.id, envio)} boton="Registrar ausencia" claseBoton="boton peligro">
                                        <label>Causa <Req /><input name="causa" required maxLength={300} placeholder="No avisó, avería, otro viaje…" /></label>
                                      </FormularioAccion>
                                    </details>
                                  </div>
                                )}
                              </td>
                            )}
                          </tr>
                        ))}</tbody>
                      </table></div>
                    )}
                    {gestiona && s.estado === 'confirmado' && libres > 0 && f.mision_id && (
                      <FormularioAccion accion={agregarCamion.bind(null, s.id, envio)} boton="Agregar camión" claseBoton="boton secundario">
                        <div className="rejilla">
                          <label>Camión (placa) <Req />
                            <select name="vehiculo_id" required defaultValue="">
                              <option value="">Seleccione…</option>
                              {vehiculos.filter((v) => v.transportista_id === s.transportista_id).map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
                            </select>
                          </label>
                          <label>Chofer <Req />
                            <select name="conductor_id" required defaultValue="">
                              <option value="">Seleccione…</option>
                              {conductores.filter((c) => c.transportista_id === s.transportista_id).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                            </select>
                          </label>
                        </div>
                        <label className="casilla"><input type="checkbox" name="asignar_igual" /> Asignar igual si ya está en otro viaje</label>
                        <p className="ayuda-campo">Faltan {plural(libres, 'camión', 'camiones')} de este transportista. ¿No aparece la placa o el chofer? Regístrelo en <Link href="/catalogos">Catálogos</Link>.</p>
                      </FormularioAccion>
                    )}
                    {gestiona && s.estado === 'confirmado' && libres > 0 && !f.mision_id && (
                      <FormularioAccion accion={crearMisionEnvio.bind(null, envio, f.pedido_id)} boton="Crear misión" claseBoton="boton secundario">
                        <p className="ayuda-campo" style={{ marginTop: 0 }}>Para cargar placas y choferes, primero cree la misión del envío (una sola por envío).</p>
                        {fabricas.length > 1 && (
                          <label>Fábrica de origen <Req />
                            <select name="origen_id" required defaultValue="">
                              <option value="">Seleccione…</option>
                              {fabricas.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                            </select>
                          </label>
                        )}
                      </FormularioAccion>
                    )}
                  </div>
                )}
              </article>
            );
          })}

          {gestiona && (
            <details id="pedir" className="pedir-camiones" open={solicitudes.length === 0 || faltan > 0}>
              <summary>Pedir camiones a un transportista{sinPedir > 0 ? ` (faltan pedir ${sinPedir})` : ''}</summary>
              <FormularioAccion accion={pedirCamiones.bind(null, envio)} boton="Registrar pedido">
                <div className="rejilla">
                  <label>Transportista <Req />
                    <select name="transportista_id" required defaultValue="">
                      <option value="">Seleccione…</option>
                      {transportistas.map((t) => (
                        <option key={t.id} value={t.id} disabled={abiertas.has(t.id)}>{t.razon_social}{abiertas.has(t.id) ? ' (ya tiene un pedido abierto)' : ''}</option>
                      ))}
                    </select>
                  </label>
                  <label>Camiones <Req />
                    <input name="camiones" type="number" min={1} max={60} inputMode="numeric" required defaultValue={Math.max(1, sinPedir || faltan)} />
                  </label>
                  <label>Presentación (si es distinta)
                    <input name="presentacion" type="datetime-local" />
                    <span className="ayuda-campo">Vacío = la del envío ({fechaHoraBolivia(f.presentacion)}).</span>
                  </label>
                  <label>Tarifa del flete
                    <input name="tarifa" inputMode="decimal" placeholder="Ej. 1500" />
                  </label>
                  <label>Tarifa por
                    <select name="tarifa_tipo" defaultValue="viaje">
                      <option value="viaje">Viaje (cada camión)</option>
                      <option value="tonelada">Tonelada</option>
                    </select>
                  </label>
                  <label>Moneda
                    <select name="moneda" defaultValue="BOB">
                      <option value="BOB">Bolivianos (Bs)</option>
                      <option value="USD">Dólares (US$)</option>
                    </select>
                  </label>
                </div>
                <label>Nota<input name="nota" maxLength={500} /></label>
              </FormularioAccion>
            </details>
          )}
        </section>
      )}

      {gestiona && (
        <section className="tarjeta">
          <h2>3. Misión del envío</h2>
          {f.mision_id ? (
            <p>
              El envío se despacha con la misión <Link href={`/misiones/${f.mision_id}`}>{f.mision_codigo}</Link>.
              Allí están el seguimiento, la invitación para cada chofer y los documentos.
            </p>
          ) : (
            <FormularioAccion accion={crearMisionEnvio.bind(null, envio, f.pedido_id)} boton="Crear misión">
              <p className="ayuda" style={{ marginTop: 0 }}>Toma el cliente, destino, producto, toneladas y fecha comprometida del envío. Se crea una sola misión por envío.</p>
              {fabricas.length > 1 && (
                <label>Fábrica de origen <Req />
                  <select name="origen_id" required defaultValue="">
                    <option value="">Seleccione…</option>
                    {fabricas.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                  </select>
                </label>
              )}
            </FormularioAccion>
          )}
        </section>
      )}

      {esLogistica && f.incoterm === 'FOB' && f.estado !== 'cancelado' && (
        <section className="tarjeta">
          <h2>Embarque en el puerto (FOB)</h2>
          <FormularioAccion accion={registrarEmbarque.bind(null, envio)} boton="Guardar fecha de embarque" claseBoton="boton secundario">
            <label>Fecha de embarque que informó el agente de carga
              <input name="embarque" type="date" defaultValue={f.embarque_fecha ?? ''} style={{ maxWidth: 220 }} />
            </label>
          </FormularioAccion>
        </section>
      )}
    </>
  );
}
