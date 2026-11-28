import Link from 'next/link';
import { ETIQUETA_ETAPA, type Etapa } from '@reynales/shared';
import { crearClienteServidor } from '@/lib/supabase/server';
import { enlaceWhatsApp, formatoHora, minutosSinSenal, TOLERANCIA_PESO } from '@/lib/tipos';
import { documentosFaltantes, nombreDocumento, TIPO_DOCUMENTO, type DocumentoVigente } from '@/lib/documentos';
import FormularioAccion from '@/componentes/FormularioAccion';
import InvitacionChofer from '@/componentes/InvitacionChofer';
import CamposCamionOperador from '@/componentes/CamposCamionOperador';
import SubirDocumento from '@/componentes/SubirDocumento';
import ListaDocumentos from '@/componentes/ListaDocumentos';
import { NotaObligatorio } from '@/componentes/Obligatorio';
import {
  agregarCamionOperador, corregirCamionOperador, nuevaInvitacionOperador, recibiCarga, registrarDocumentoOperador,
} from '../acciones';

export const dynamic = 'force-dynamic';

interface Camion {
  id: string; placa: string; chofer: string; telefono: string | null; etapa: Etapa;
  toneladas: number | null; precinto: string | null; ultima_senal: string | null;
  invitacion?: { codigo: string; vence_en: string; usado_en: string | null } | null;
}
interface Carga {
  id: string; codigo: string; etapa: Etapa; tramo: number; ultimo_tramo: number; lugar: string | null; cliente: string;
  factura: string | null; guia: string | null; dex: string | null; tipo_carga: string | null;
  destino: string; destino_pais: string; telefono_coordinador: string | null; toneladas_fabrica: number | null;
  llegan: Camion[]; mis_camiones: Camion[]; documentos: DocumentoVigente[];
}

const EN_VIAJE: Etapa[] = ['cargado', 'en_ruta', 'en_frontera', 'cruzo_frontera'];
const tn = (n: number | null | undefined) => (n ?? 0).toLocaleString('es-BO');
/** Toneladas de un camión: «sin registrar» si todavía no se anotaron (no «0 TN»). */
const tnCamion = (n: number | null | undefined) => (n === null || n === undefined ? 'toneladas sin registrar' : `${tn(n)} TN`);

/** Detalle de una carga en el transbordo: lo que llega, los camiones propios y los documentos. */
export default async function PaginaCargaTransbordo({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await crearClienteServidor();
  const [{ data, error }, { data: catalogoData }] = await Promise.all([
    supabase.rpc('operador_carga', { p_mision: id }),
    supabase.rpc('operador_catalogo'),
  ]);
  if (error || !data) {
    return (
      <div className="tarjeta">
        <p className="mensaje-error">{error?.message.includes('no está asignada') ? 'Esta carga no está asignada a su empresa.' : 'No se pudo abrir la carga.'}</p>
        <Link href="/transbordo">← Volver a mis cargas</Link>
      </div>
    );
  }
  const c = data as Carga;
  const catalogo = (catalogoData ?? { conductores: [], vehiculos: [] }) as {
    conductores: { id: string; nombre: string }[]; vehiculos: { id: string; placa: string }[];
  };
  const cerrada = c.etapa === 'entregado' || c.etapa === 'cancelado';
  const declaradas = c.mis_camiones.reduce((t, a) => t + (a.toneladas ?? 0), 0);
  const fabrica = c.toneladas_fabrica ?? 0;
  const diferencia = fabrica > 0 && declaradas > 0 ? Math.abs(declaradas - fabrica) / fabrica : null;
  const aPeru = c.destino_pais === 'PE';
  const etiqueta = (a: Camion, propio: boolean) =>
    !propio && a.etapa === 'entregado' ? 'Carga recibida' : ETIQUETA_ETAPA[a.etapa];
  const llamar = (tel: string | null) => (tel ? (
    <a href={`tel:${tel.replace(/[^0-9+]/g, '')}`}>{tel}</a>
  ) : 'sin teléfono');

  return (
    <>
      <p><Link href="/transbordo">← Mis cargas</Link></p>
      <section className="tarjeta">
        <div className="carga-titulo">
          <h1 style={{ margin: 0 }}>{c.codigo}</h1>
          <span className={`etiqueta ${c.etapa}`}>{ETIQUETA_ETAPA[c.etapa]}</span>
        </div>
        <dl className="seg-datos" style={{ marginTop: 12 }}>
          <dt>Cliente</dt><dd>{c.cliente}</dd>
          <dt>Destino</dt><dd>{c.destino}</dd>
          <dt>Transbordo</dt><dd>{c.lugar ?? 'Lugar a coordinar con despacho'}</dd>
          <dt>Factura</dt><dd>{c.factura ?? '—'}</dd>
          <dt>Guía</dt><dd>{c.guia ?? '—'}</dd>
          <dt>DEX</dt><dd>{c.dex ?? '—'}</dd>
          {c.tipo_carga && (<><dt>Carga</dt><dd>{c.tipo_carga}</dd></>)}
          <dt>Pesado en fábrica</dt><dd><strong>{fabrica > 0 ? `${tn(fabrica)} TN` : 'sin registrar'}</strong></dd>
        </dl>
        {c.telefono_coordinador && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            <a className="boton secundario" href={`tel:${c.telefono_coordinador.replace(/[^0-9+]/g, '')}`}>Llamar a despacho</a>
            {enlaceWhatsApp(c.telefono_coordinador, `Consulta sobre la carga ${c.codigo} (transbordo).`) && (
              <a className="boton secundario" href={enlaceWhatsApp(c.telefono_coordinador, `Consulta sobre la carga ${c.codigo} (transbordo).`)!} target="_blank" rel="noreferrer">WhatsApp a despacho</a>
            )}
          </div>
        )}
      </section>

      <section className="tarjeta">
        <h2>1. Camiones que llegan de fábrica</h2>
        {c.llegan.length === 0 && <p>Despacho todavía no registró los camiones que traen la carga.</p>}
        {c.llegan.map((a) => {
          const min = minutosSinSenal(a.ultima_senal);
          return (
            <div key={a.id} className="camion-transbordo">
              <div className="carga-titulo">
                <strong>{a.placa}</strong>
                <span className={`etiqueta ${a.etapa}`}>{etiqueta(a, false)}</span>
              </div>
              <p style={{ margin: '4px 0' }}>
                {a.chofer} · {llamar(a.telefono)} · {tnCamion(a.toneladas)}
                {a.ultima_senal && <><br /><span className="ayuda">Última señal: {formatoHora(a.ultima_senal)}{min !== null ? ` (hace ${min} min)` : ''}</span></>}
              </p>
              {EN_VIAJE.includes(a.etapa) && (
                <details className="agregar">
                  <summary>Recibí la carga de este camión</summary>
                  <FormularioAccion accion={recibiCarga.bind(null, a.id, c.id)} boton="Confirmar: recibí la carga">
                    <label>Observación (opcional)<input name="nota" placeholder="Ej. llegó completa, sin novedad" /></label>
                  </FormularioAccion>
                </details>
              )}
            </div>
          );
        })}
      </section>

      <section className="tarjeta">
        <h2>2. Sus camiones hacia {c.destino}</h2>
        <p style={{ fontSize: 14 }}>
          Declarado: <strong>{tn(declaradas)} de {tn(fabrica)} TN</strong>
        </p>
        {diferencia !== null && diferencia > TOLERANCIA_PESO && (
          <p className="alerta" role="alert">
            La diferencia con lo pesado en fábrica es de {(diferencia * 100).toFixed(1)} % (máximo 0,5 %). Revise las toneladas o avise a despacho.
          </p>
        )}
        {c.mis_camiones.map((a) => {
          const faltan = aPeru ? documentosFaltantes(c.documentos, a.id) : [];
          const abierta = a.etapa !== 'entregado' && a.etapa !== 'cancelado';
          return (
            <div key={a.id} className="camion-transbordo">
              <div className="carga-titulo">
                <strong>{a.placa}</strong>
                <span className={`etiqueta ${a.etapa}`}>{etiqueta(a, true)}</span>
              </div>
              <p style={{ margin: '4px 0' }}>
                {a.chofer} · {llamar(a.telefono)} · {tnCamion(a.toneladas)} · Precinto {a.precinto ?? '—'}
              </p>
              {faltan.length > 0 ? (
                <p className="alerta">Falta subir: {faltan.map((t) => TIPO_DOCUMENTO[t]).join(' y ')}.</p>
              ) : aPeru ? <p className="mensaje-ok" style={{ padding: 6 }}>CRT y MIC/DTA cargados ✓</p> : null}
              {abierta && (
                <InvitacionChofer
                  nombreChofer={a.chofer}
                  telefonoChofer={a.telefono}
                  codigoMision={c.codigo}
                  generar={nuevaInvitacionOperador.bind(null, a.id)}
                  vigente={a.invitacion ?? null}
                  sinWhatsapp="Este chofer no tiene WhatsApp con código de país. Use «Copiar mensaje» o pida a despacho que corrija el número."
                />
              )}
              {(a.etapa === 'programado' || a.etapa === 'cargado') && (
                <details className="agregar" style={{ marginTop: 8 }}>
                  <summary>Corregir toneladas o precinto</summary>
                  <FormularioAccion accion={corregirCamionOperador.bind(null, a.id, c.id)} boton="Guardar" claseBoton="boton secundario">
                    <div className="rejilla">
                      <label>Toneladas<input name="toneladas" required inputMode="decimal" defaultValue={a.toneladas ?? ''} /></label>
                      <label>N.º de precinto<input name="precinto" required defaultValue={a.precinto ?? ''} /></label>
                    </div>
                  </FormularioAccion>
                </details>
              )}
            </div>
          );
        })}
        {!cerrada && (
          <details className="agregar" open={c.mis_camiones.length === 0}>
            <summary>+ Registrar {c.mis_camiones.length === 0 ? 'un camión' : 'otro camión'}</summary>
            <FormularioAccion accion={agregarCamionOperador.bind(null, c.id)} boton="Registrar camión">
              <CamposCamionOperador conductores={catalogo.conductores} placas={catalogo.vehiculos.map((v) => v.placa)} />
              <NotaObligatorio />
            </FormularioAccion>
          </details>
        )}
      </section>

      <section className="tarjeta">
        <h2>3. Documentos (DEX, lista de empaque, CRT, MIC/DTA y fotos)</h2>
        <ListaDocumentos documentos={c.documentos} />
        {!cerrada && (
          <>
            <h3 style={{ marginTop: 16 }}>Subir documento</h3>
            <SubirDocumento
              misionId={c.id}
              tipos={['crt', 'mic_dta', 'otro']}
              camiones={c.mis_camiones.filter((a) => a.etapa !== 'cancelado').map((a) => ({ id: a.id, placa: a.placa }))}
              reemplazables={c.documentos.map((d) => ({ id: d.id, texto: `${nombreDocumento(d.tipo, d.etiqueta)}${d.numero ? ` ${d.numero}` : ''} · ${d.placa ?? 'toda la carga'}` }))}
              registrar={registrarDocumentoOperador.bind(null, c.id)}
            />
          </>
        )}
      </section>
    </>
  );
}
