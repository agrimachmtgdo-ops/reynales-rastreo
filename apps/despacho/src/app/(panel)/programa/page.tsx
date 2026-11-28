import Link from 'next/link';
import { crearClienteServidor } from '@/lib/supabase/server';
import FiltrosAutomaticos from '@/componentes/FiltrosAutomaticos';
import FormularioAccion from '@/componentes/FormularioAccion';
import { ESTADO_ENVIO, formatoFecha, formatoToneladas, resumenDespacho, sumarDias, type CamionDespacho } from '@/lib/pedidos';
import { fechaCarga, formatoCosto, horaBolivia, NOMBRE_SEMAFORO, semaforo, type FilaPrograma, type Semaforo } from '@/lib/programa';
import { fijarDiasAnticipacion } from './acciones';

export const dynamic = 'force-dynamic';

const esFecha = (v: string | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
const ORDEN: Semaforo[] = ['rojo', 'parcial', 'amarillo', 'a_tiempo', 'listo', 'en_curso'];

/** Programa de despachos: envíos confirmados por fecha de carga, con el semáforo de camiones. */
export default async function PaginaPrograma({ searchParams }: { searchParams: Promise<{ desde?: string; hasta?: string }> }) {
  const sp = await searchParams;
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/La_Paz' });
  const desde = esFecha(sp.desde) ? sp.desde : sumarDias(hoy, -2);
  const hasta = esFecha(sp.hasta) ? sp.hasta : sumarDias(hoy, 21);
  const supabase = await crearClienteServidor();
  const [{ data, error }, { data: dias }, { data: perfil }] = await Promise.all([
    supabase.rpc('resumen_programa', { p_desde: desde, p_hasta: hasta }),
    supabase.rpc('dias_anticipacion_camiones'),
    supabase.rpc('perfil_actual'),
  ]);
  if (error) {
    return (
      <section className="tarjeta"><h1>Programa de despachos</h1>
        <div className="mensaje-error">
          No se pudo cargar el programa: {error.message.includes('Could not find the function') ? 'falta aplicar la migración del requerimiento de camiones en Supabase.' : error.message}
        </div>
      </section>
    );
  }
  const diasAnticipacion = Number(dias ?? 4);
  const filas = ((data ?? []) as FilaPrograma[]).map((f) => ({ ...f, luz: semaforo(f, hoy, diasAnticipacion) }));
  // Toneladas que ya salieron de fábrica por envío (camiones del tramo 1 de cada misión).
  const misiones = filas.map((f) => f.mision_id).filter((m): m is string => !!m);
  const { data: camData } = misiones.length
    ? await supabase.from('asignaciones').select('mision_id, etapa, toneladas_cargadas').eq('tramo', 1).in('mision_id', misiones)
    : { data: [] };
  const camionesPorMision = new Map<string, CamionDespacho[]>();
  for (const c of (camData ?? []) as (CamionDespacho & { mision_id: string })[]) {
    camionesPorMision.set(c.mision_id, [...(camionesPorMision.get(c.mision_id) ?? []), c]);
  }
  const despachoDe = (f: FilaPrograma) =>
    resumenDespacho(Number(f.toneladas), f.camiones_necesarios, f.mision_id ? camionesPorMision.get(f.mision_id) ?? [] : []);
  const cuenta = (s: Semaforo) => filas.filter((f) => f.luz === s).length;
  const porFecha = new Map<string, typeof filas>();
  for (const f of filas) {
    const k = fechaCarga(f);
    porFecha.set(k, [...(porFecha.get(k) ?? []), f]);
  }
  const esLogistica = perfil === 'administrador' || perfil === 'logistica';

  return (
    <>
      <section className="tarjeta">
        <h1>Programa de despachos</h1>
        <p className="ayuda" style={{ marginTop: 0 }}>
          Envíos confirmados por fecha de carga en fábrica. El semáforo avisa cuando faltan camiones confirmados:
          <strong> amarillo</strong> a {diasAnticipacion} días o menos de la carga y <strong>rojo</strong> a 2 días o menos.
        </p>
        <FiltrosAutomaticos className="filtros-misiones">
          <label>Carga desde<input type="date" name="desde" defaultValue={desde} /></label>
          <label>Hasta<input type="date" name="hasta" defaultValue={hasta} /></label>
          <div className="acciones-filtro">
            {(sp.desde || sp.hasta) && <Link href="/programa" className="enlace-cancelar">Próximas 3 semanas</Link>}
          </div>
        </FiltrosAutomaticos>
        <ul className="resumen-semaforo" role="status">
          {ORDEN.filter((s) => cuenta(s) > 0).map((s) => (
            <li key={s}><span className={`luz luz-${s}`} aria-hidden="true" /> {cuenta(s)} {NOMBRE_SEMAFORO[s].toLowerCase()}</li>
          ))}
          {filas.length === 0 && <li>No hay envíos confirmados con carga entre el {formatoFecha(desde)} y el {formatoFecha(hasta)}.</li>}
        </ul>
      </section>

      {[...porFecha.entries()].map(([fecha, lista]) => (
        <section className="tarjeta" key={fecha}>
          <h2>
            Carga {formatoFecha(fecha)}
            {fecha === hoy && <span className="etiqueta reprogramado">Hoy</span>}
            {fecha < hoy && <span className="etiqueta cancelado" style={{ marginLeft: 6 }}>Pasada</span>}
          </h2>
          <div className="tabla-desplazable">
            <table className="tabla-programa">
              <thead><tr><th>Camiones</th><th>Envío</th><th>Cliente y destino</th><th className="numero">Toneladas</th><th className="numero">Saldo t</th><th>Presentación</th><th>Misión</th><th>Costo flete</th><th><span className="solo-lector">Acción</span></th></tr></thead>
              <tbody>{lista.map((f) => (
                <tr key={f.envio_id}>
                  <td>
                    <span className={`semaforo luz-${f.luz}`}><span className={`luz luz-${f.luz}`} aria-hidden="true" />{NOMBRE_SEMAFORO[f.luz]}</span>
                    <div className="ayuda-campo">
                      {f.camiones_confirmados}/{f.camiones_necesarios} confirmados
                      {f.camiones_pedidos > f.camiones_confirmados && ` · ${f.camiones_pedidos - f.camiones_confirmados} sin respuesta`}
                      {f.camiones_asignados > 0 && ` · ${f.camiones_asignados} con placa`}
                      {f.camiones_en_fabrica > 0 && ` · ${f.camiones_en_fabrica} en fábrica`}
                      {f.camiones_ausentes > 0 && ` · ${f.camiones_ausentes} no se presentó`}
                    </div>
                  </td>
                  <td>
                    <Link href={`/pedidos/${f.pedido_id}`}>{f.pedido_codigo}</Link> · envío {f.numero}
                    <div className="ayuda-campo">{f.producto}{f.orden_compra ? ` · OC ${f.orden_compra}` : ''}</div>
                  </td>
                  <td>
                    {f.cliente}
                    <div className="ayuda-campo">{f.incoterm} {f.destino} · entrega {formatoFecha(f.entrega_vigente)}{f.embarque_fecha ? ` · embarque ${formatoFecha(f.embarque_fecha)}` : ''}</div>
                  </td>
                  <td data-etiqueta="Toneladas" className="numero">{formatoToneladas(Number(f.toneladas))}</td>
                  {(() => {
                    const d = despachoDe(f);
                    if (f.estado === 'cancelado') return <td data-etiqueta="Saldo t" className="numero">—</td>;
                    return (
                      <td data-etiqueta="Saldo t" className="numero">
                        <span className={d.saldo > 0 ? (d.enviadas > 0 ? 'saldo-parcial' : undefined) : 'saldo-cero'}>{formatoToneladas(d.saldo)}</span>
                        {d.enviadas > 0 && <span className="sub-dato">salieron {formatoToneladas(d.enviadas)}{d.sinPeso > 0 ? ' (estim.)' : ''}</span>}
                      </td>
                    );
                  })()}
                  <td data-etiqueta="Presentación">{f.presentacion ? horaBolivia(f.presentacion) : '—'}</td>
                  <td data-etiqueta="Misión">
                    {f.mision_id ? <Link href={`/misiones/${f.mision_id}`}>{f.mision_codigo}</Link> : '—'}
                    {f.estado !== 'pendiente' && <div><span className={`etiqueta envio-${f.estado}`}>{ESTADO_ENVIO[f.estado] ?? f.estado}</span></div>}
                  </td>
                  <td data-etiqueta="Costo flete">{formatoCosto(f.costo)}</td>
                  <td><Link className="boton secundario" href={`/programa/${f.envio_id}`}>{esLogistica ? 'Gestionar camiones' : 'Ver detalle'}</Link></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      ))}

      {perfil === 'administrador' && (
        <section className="tarjeta">
          <details>
            <summary>Ajuste: días de anticipación para pedir camiones ({diasAnticipacion})</summary>
            <FormularioAccion accion={fijarDiasAnticipacion} boton="Guardar">
              <label>Avisar en amarillo cuando falten estos días para la carga
                <input name="dias" type="number" min={1} max={30} defaultValue={diasAnticipacion} required inputMode="numeric" style={{ maxWidth: 120 }} />
              </label>
            </FormularioAccion>
          </details>
        </section>
      )}
    </>
  );
}
