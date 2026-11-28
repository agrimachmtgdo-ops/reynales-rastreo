import { notFound } from 'next/navigation';
import { ETAPAS, ETIQUETA_ETAPA, esInternacional, type Etapa } from '@reynales/shared';
import { crearClienteServidor } from '@/lib/supabase/server';
import { cargarCatalogosCamion } from '@/lib/catalogos';
import { SELECT_ASIGNACION_EN_VIVO } from '@/lib/consultas';
import {
  enlaceWhatsApp, enTransbordo, estimarLlegada, formatoHora, kmRecorridos, minutosSinSenal, textoEmergencia, TOLERANCIA_PESO,
  VELOCIDAD_PROMEDIO_KMH, type AsignacionEnVivo,
} from '@/lib/tipos';
import CamposCamion from '@/componentes/CamposCamion';
import FormularioAccion from '@/componentes/FormularioAccion';
import InvitacionChofer from '@/componentes/InvitacionChofer';
import MapaMision from '@/componentes/MapaMision';
import RefrescoEnVivo from '@/componentes/RefrescoEnVivo';
import BotonImprimir from '@/componentes/BotonImprimir';
import BarraEtapas from '@/componentes/BarraEtapas';
import EnlaceCliente from '@/componentes/EnlaceCliente';
import SubirDocumento from '@/componentes/SubirDocumento';
import ListaDocumentos from '@/componentes/ListaDocumentos';
import IndicadorDocumentos from '@/componentes/IndicadorDocumentos';
import { CLAVES_DESPACHO, claveDe, documentosFaltantes, nombreDocumento, TIPO_DOCUMENTO, type DocumentoVigente } from '@/lib/documentos';
import {
  agregarCamion, agregarTransbordo, anularEnlaceSeguimiento, atenderEmergencia, cambiarEtapaManual, crearEnlaceSeguimiento, crearInvitacion,
  editarMision, editarTramo, fijarToneladasDeclaradas, registrarDocumentoDespacho,
} from '../acciones';

export const dynamic = 'force-dynamic';

interface Tramo {
  id: string;
  numero: number;
  lugar_inicio: string | null;
  transportista_id: string | null;
  transportista: { razon_social: string } | null;
}

interface Evento {
  id: string;
  asignacion_id: string;
  tipo: string;
  etapa_nueva: Etapa | null;
  origen: string;
  ocurrido_en: string;
  hora_dispositivo: string | null;
  detalle: Record<string, unknown>;
}

/** ISO → «AAAA-MM-DDTHH:MM» en hora de Bolivia, para un campo datetime-local. */
const aFechaHoraBolivia = (iso: string | null) => (iso ? new Date(Date.parse(iso) - 4 * 3_600_000).toISOString().slice(0, 16) : '');

const nombreEtapa = (etapa: unknown) => (typeof etapa === 'string' ? ETIQUETA_ETAPA[etapa as Etapa] ?? etapa : '');

/** Convierte un evento en una frase que despacho entienda sin conocer el sistema. */
function describirEvento(e: Evento, chofer: string, entregaEnTransbordo = false): string {
  const d = e.detalle ?? {};
  const antes = d.etapa_anterior ? ` (antes: ${nombreEtapa(d.etapa_anterior)})` : '';
  if (e.tipo === 'incidencia' && d.motivo === 'diferencia_peso_transbordo') {
    const fab = Number(d.fabrica);
    const dec = d.declaradas === null || d.declaradas === undefined ? null : Number(d.declaradas);
    return dec === null
      ? `Alerta: el tramo ${String(d.tramo)} salió sin toneladas declaradas (en fábrica se pesaron ${fab} TN). Anótelas en cada camión del tramo.`
      : `Alerta: el tramo ${String(d.tramo)} salió con ${dec} TN declaradas y en fábrica se pesaron ${fab} TN (diferencia de ${(Math.abs(dec - fab) / fab * 100).toFixed(1)} %, más del 0,5 % permitido).`;
  }
  if (e.tipo === 'incidencia' && d.motivo === 'sin_documentos_transbordo') {
    const faltan = Array.isArray(d.faltan) ? (d.faltan as string[]).map((t) => TIPO_DOCUMENTO[t] ?? t).join(' y ') : 'documentos';
    return `Alerta: el camión salió hacia la frontera sin ${faltan}. Pida al operador del transbordo que los suba.`;
  }
  if (e.tipo === 'incidencia' && d.motivo === 'sin_documentos_carga') {
    const faltan = Array.isArray(d.faltan) ? (d.faltan as string[]).map((t) => TIPO_DOCUMENTO[t] ?? t).join(' y ') : 'documentos';
    return `Alerta: el camión salió de fábrica sin ${faltan} en el sistema. Súbalos en «Documentos».`;
  }
  if (e.tipo === 'nota' && d.motivo === 'camion_registrado_por_operador') {
    return `${String(d.operador ?? 'El operador')} (transbordo) registró este camión: ${String(d.toneladas)} TN declaradas, precinto ${String(d.precinto)}. Ya tiene código para la app.`;
  }
  if (e.tipo === 'nota' && d.motivo === 'documento_operador') {
    return `${String(d.operador ?? 'El operador')} (transbordo) subió el ${TIPO_DOCUMENTO[String(d.documento)] ?? String(d.documento)} N.º ${String(d.numero ?? '')}.`;
  }
  if (e.tipo === 'cambio_etapa' && e.etapa_nueva && d.motivo === 'recibido_en_transbordo') {
    return `${String(d.operador ?? 'El operador')} (transbordo) confirmó que recibió la carga: «Entregado en transbordo»${d.nota ? `. Nota: ${String(d.nota)}` : ''}.`;
  }
  if (e.tipo === 'cambio_etapa' && e.etapa_nueva) {
    const etapa = entregaEnTransbordo && e.etapa_nueva === 'entregado' ? '«Entregado en transbordo»' : `«${nombreEtapa(e.etapa_nueva)}»`;
    if (e.origen === 'chofer') return `${chofer} marcó ${etapa} desde la app${antes}.`;
    if (e.origen === 'despacho') return `Despacho cambió la etapa a ${etapa}${antes}${d.nota ? `. Nota: ${String(d.nota)}` : ''}.`;
    if (d.motivo === 'salio_de_origen') return `El sistema detectó que el camión salió de fábrica: ${etapa}${antes}.`;
    if (d.motivo === 'cruce_sin_parada') return `El sistema detectó que el camión cruzó la frontera por ${String(d.frontera)} sin detenerse en la frontera${antes}.`;
    if (d.frontera) return `El sistema detectó ${etapa} en ${String(d.frontera)}${antes}.`;
    return `El sistema cambió la etapa a ${etapa}${antes}.`;
  }
  if (e.tipo === 'incidencia' && d.motivo === 'inicio_lejos_de_origen') {
    return `Alerta: al iniciar el viaje el teléfono estaba a ${String(d.km)} km de ${String(d.origen ?? 'la fábrica')}. Revise que el chofer esté en el camión y que el punto de la fábrica sea correcto.`;
  }
  if (e.tipo === 'incidencia' && d.motivo === 'ubicacion_simulada') {
    return `Alerta: el teléfono envió ${String(d.cantidad ?? 'algunas')} ubicaciones simuladas (posible GPS falso). Se descartaron.`;
  }
  if (e.tipo === 'emergencia') {
    const donde = typeof d.lat === 'number' && typeof d.lon === 'number' ? ` Ubicación: ${d.lat.toFixed(5)}, ${d.lon.toFixed(5)}.` : ' Sin ubicación.';
    return `EMERGENCIA reportada por ${chofer} desde la app: ${textoEmergencia(d.motivo as string)}.${donde}`;
  }
  if (e.tipo === 'nota' && d.motivo === 'activacion') return `${chofer} activó el código en su teléfono (terminado en …${String(d.dispositivo ?? '')}).`;
  if (e.tipo === 'nota' && d.motivo === 'reactivacion') return `${chofer} volvió a activar el código en el mismo teléfono (por ejemplo, reinstaló la app).`;
  if (e.tipo === 'incidencia' && d.motivo === 'salto_ubicacion') {
    return `Alerta: el teléfono envió ${String(d.cantidad ?? 'algunas')} ubicaciones imposibles (saltos de más de 150 km/h). No se usaron para el mapa ni las etapas.`;
  }
  if (e.tipo === 'nota') return `Nota${e.origen === 'despacho' ? ' de despacho' : ''}: ${String(d.nota ?? '')}`;
  const resto = Object.entries(d).map(([k, v]) => `${k}: ${String(v)}`).join(' · ');
  return `${e.tipo}${resto ? ` (${resto})` : ''}`;
}

export default async function PaginaDetalleMision({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await crearClienteServidor();

  const { data: mision } = await supabase
    .from('misiones')
    .select(`id, codigo, etapa, factura, guia, dex, tipo_carga, tonelaje_objetivo, telefono_coordinador, notas, entrega_comprometida,
             cliente:clientes(razon_social, pais, whatsapp),
             origen:ubicaciones!misiones_origen_id_fkey(nombre),
             destino:ubicaciones!misiones_destino_id_fkey(nombre, pais, lat, lon)`)
    .eq('id', id)
    .maybeSingle();
  if (!mision) notFound();

  const [{ data: asigData }, catalogos, { data: enlaceData }, { data: tramosData }] = await Promise.all([
    supabase.from('asignaciones').select(SELECT_ASIGNACION_EN_VIVO).eq('mision_id', id).order('creado_en'),
    cargarCatalogosCamion(),
    supabase.from('enlaces_seguimiento').select('token, creado_en, visitas, ultima_visita')
      .eq('mision_id', id).eq('estado', 'activo').order('creado_en', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('tramos').select('id, numero, lugar_inicio, transportista_id, transportista:transportistas(razon_social)')
      .eq('mision_id', id).order('numero'),
  ]);
  const { data: documentosData } = await supabase.from('documentos')
    .select('id, tipo, etiqueta, numero, nombre_original, ruta_archivo, asignacion_id, tipo_mime, creado_en, operador:operadores_transbordo(nombre)')
    .eq('mision_id', id).is('reemplazado_por', null).order('creado_en', { ascending: false });
  const tramos = (tramosData ?? []) as unknown as Tramo[];
  const ultimoTramo = Math.max(1, ...tramos.map((t) => t.numero));
  const enlaceCliente = (enlaceData ?? null) as { token: string; creado_en: string; visitas: number; ultima_visita: string | null } | null;
  const asignaciones = (asigData ?? []) as unknown as AsignacionEnVivo[];
  const ids = asignaciones.map((a) => a.id);
  const tramoDe = (asigId: string) => asignaciones.find((a) => a.id === asigId)?.tramo ?? 1;
  // Un camión de un tramo intermedio «entrega» en el transbordo, no en el destino.
  const intermedio = (asigId: string) => tramoDe(asigId) < ultimoTramo;
  const transbordoEnCurso = enTransbordo(asignaciones, ultimoTramo);

  // Invitación más reciente (no anulada) de cada camión, para mostrarla al recargar la página.
  const { data: invitacionesData } = ids.length
    ? await supabase.from('invitaciones_chofer').select('asignacion_id, codigo, vence_en, usado_en, creado_en')
        .in('asignacion_id', ids).eq('revocada', false).order('creado_en', { ascending: false })
    : { data: [] };
  const invitacionDe = (asigId: string) =>
    ((invitacionesData ?? []) as { asignacion_id: string; codigo: string; vence_en: string; usado_en: string | null }[])
      .find((i) => i.asignacion_id === asigId) ?? null;

  const { data: eventosData } = ids.length
    ? await supabase.from('eventos').select('id, asignacion_id, tipo, etapa_nueva, origen, ocurrido_en, hora_dispositivo, detalle')
        .in('asignacion_id', ids).order('ocurrido_en', { ascending: false }).order('creado_en', { ascending: false }).limit(50)
    : { data: [] };
  const eventos = (eventosData ?? []) as Evento[];

  // Recorrido completo (simplificado) de cada camión con señal: una línea por camión.
  const conSenal = asignaciones.filter((a) => a.ultima_senal);
  const recorridos = await Promise.all(
    conSenal.map(async (a) => {
      const { data } = await supabase.rpc('recorrido_simplificado', { p_asignacion: a.id, p_tolerancia_m: 25 });
      return ((data ?? []) as { lat: number; lon: number }[]).map((p) => [p.lat, p.lon] as [number, number]);
    }),
  );
  const recorridoDe = (asigId: string) => recorridos[conSenal.findIndex((a) => a.id === asigId)] ?? [];

  // Primera vez que algún camión alcanzó cada etapa (para la barra de avance).
  const { data: hitosData } = ids.length
    ? await supabase.from('eventos').select('asignacion_id, etapa_nueva, ocurrido_en')
        .in('asignacion_id', ids).eq('tipo', 'cambio_etapa').order('ocurrido_en', { ascending: true }).limit(500)
    : { data: [] };
  const horasEtapa: Partial<Record<Etapa, string>> = {};
  for (const h of (hitosData ?? []) as { asignacion_id: string; etapa_nueva: Etapa | null; ocurrido_en: string }[]) {
    if (h.etapa_nueva === 'entregado' && intermedio(h.asignacion_id)) continue; // la entrega en transbordo no es un hito
    if (h.etapa_nueva && !horasEtapa[h.etapa_nueva]) horasEtapa[h.etapa_nueva] = h.ocurrido_en;
  }

  const m = mision as unknown as {
    codigo: string; etapa: Etapa; factura: string | null; guia: string | null; dex: string | null;
    tipo_carga: string | null; tonelaje_objetivo: number | null; telefono_coordinador: string | null; notas: string | null;
    entrega_comprometida: string | null;
    cliente: { razon_social: string; pais: string; whatsapp: string | null } | null; origen: { nombre: string } | null; destino: { nombre: string; pais: string; lat: number; lon: number } | null;
  };
  const puntoDestino: [number, number] | null = m.destino ? [m.destino.lat, m.destino.lon] : null;
  const placaDe = (asigId: string) => asignaciones.find((a) => a.id === asigId)?.vehiculo?.placa ?? '';
  const choferDe = (asigId: string) => asignaciones.find((a) => a.id === asigId)?.conductor?.nombre ?? 'El chofer';

  const documentos: DocumentoVigente[] = ((documentosData ?? []) as unknown as {
    id: string; tipo: string; etiqueta: string | null; numero: string | null; nombre_original: string | null; ruta_archivo: string;
    asignacion_id: string | null; tipo_mime: string | null; creado_en: string; operador: { nombre: string } | null;
  }[]).map((d) => ({
    id: d.id, tipo: d.tipo, etiqueta: d.etiqueta, numero: d.numero, nombre: d.nombre_original, ruta: d.ruta_archivo, asignacion_id: d.asignacion_id,
    placa: d.asignacion_id ? placaDe(d.asignacion_id) || null : null, tipo_mime: d.tipo_mime, creado_en: d.creado_en,
    subido_por: d.operador ? `${d.operador.nombre} (transbordo)` : null,
  }));
  // Últimas aperturas de documentos de esta misión (quién y cuándo).
  const { data: accesosData } = await supabase.from('descargas_documentos')
    .select('id, descargado_en, usuario_id, operador:operadores_transbordo(nombre), documento:documentos!inner(tipo, etiqueta, numero, mision_id)')
    .eq('documento.mision_id', id).not('usuario_id', 'is', null)
    .order('descargado_en', { ascending: false }).limit(20);
  const accesos = (accesosData ?? []) as unknown as {
    id: string; descargado_en: string; usuario_id: string | null; operador: { nombre: string } | null;
    documento: { tipo: string; etiqueta: string | null; numero: string | null };
  }[];
  const idsPersonal = [...new Set(accesos.filter((a) => !a.operador && a.usuario_id).map((a) => a.usuario_id!))];
  // Solo el administrador ve los nombres del personal; los demás ven «Personal de Reynales».
  const { data: personalData } = idsPersonal.length
    ? await supabase.from('usuarios').select('id, nombre').in('id', idsPersonal)
    : { data: [] };
  const nombrePersonal = (uid: string | null) =>
    ((personalData ?? []) as { id: string; nombre: string | null }[]).find((u) => u.id === uid)?.nombre || 'Personal de Reynales';

  const tnFabrica = asignaciones
    .filter((a) => (a.tramo ?? 1) === 1 && a.etapa !== 'cancelado')
    .reduce((t, a) => t + (a.toneladas_cargadas ?? 0), 0);
  const puedeAgregarTransbordo = ultimoTramo < 3 && m.etapa !== 'entregado' && m.etapa !== 'cancelado'
    && !asignaciones.some((a) => (a.tramo ?? 1) === ultimoTramo && a.etapa === 'entregado');

  const tarjetaCamion = (a: AsignacionEnVivo) => {
    const min = minutosSinSenal(a.ultima_senal);
    const cerrada = a.etapa === 'entregado' || a.etapa === 'cancelado';
    return (
      <section key={a.id} className={`tarjeta${a.emergencia_en ? ' emergencia' : ''}`}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>{a.vehiculo?.placa} · {a.conductor?.nombre}</h2>
          <span className={`etiqueta ${a.etapa}`}>{a.etapa === 'entregado' && intermedio(a.id) ? 'Entregado en transbordo' : ETIQUETA_ETAPA[a.etapa]}</span>
        </div>
        <p style={{ fontSize: 14 }}>
          Última señal: {formatoHora(a.ultima_senal)} {min !== null && `(hace ${min} min)`} ·{' '}
          {a.ultima_velocidad_kmh ?? 0} km/h ·{' '}
          {(a.tramo ?? 1) > 1
            ? (a.toneladas_declaradas !== null && a.toneladas_declaradas !== undefined ? `${a.toneladas_declaradas} TN declaradas` : 'TN declaradas sin registrar')
            : (a.toneladas_cargadas ? `${a.toneladas_cargadas} TN cargadas` : 'TN sin registrar')}
          {a.precinto && ` · Precinto ${a.precinto}`}
        </p>
        {(a.tramo ?? 1) > 1 && esInternacional(m.destino?.pais) && a.etapa !== 'cancelado' && documentosFaltantes(documentos, a.id).length > 0 && (
          <p className="alerta">Falta {documentosFaltantes(documentos, a.id).map((t) => TIPO_DOCUMENTO[t]).join(' y ')} de este camión.</p>
        )}
        {(() => {
          const recorrido = recorridoDe(a.id);
          const km = kmRecorridos(recorrido);
          const enViaje = ['cargado', 'en_ruta', 'en_frontera', 'cruzo_frontera'].includes(a.etapa);
          const posicion: [number, number] | null = a.ultima_lat !== null && a.ultima_lon !== null ? [a.ultima_lat, a.ultima_lon] : null;
          // Un tramo intermedio termina en el transbordo (lugar variable): sin estimación al destino final.
          const estimacion = enViaje && !intermedio(a.id) ? estimarLlegada(posicion, puntoDestino, a.ultima_senal) : null;
          if (recorrido.length < 2 && !estimacion) return null;
          return (
            <div className="datos-viaje">
              <span>Recorrido: <strong>{Math.round(km)} km</strong></span>
              {estimacion && (
                <>
                  <span>Faltan aprox.: <strong>{Math.round(estimacion.kmRestantes)} km</strong></span>
                  <span title={`Distancia en línea recta × 1,25 a ${VELOCIDAD_PROMEDIO_KMH} km/h promedio, desde la última señal`}>
                    Llegada estimada: <strong>{formatoHora(estimacion.llegada)}</strong>
                    {esInternacional(m.destino?.pais) && (a.etapa === 'cargado' || a.etapa === 'en_ruta' || a.etapa === 'en_frontera') && ' (sin contar la espera en frontera)'}
                  </span>
                </>
              )}
            </div>
          );
        })()}
        {a.emergencia_en && (
          <div className="aviso-emergencia no-imprimir" role="alert">
            <strong>EMERGENCIA: {textoEmergencia(a.emergencia_motivo)}</strong> · reportada {formatoHora(a.emergencia_en)}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '8px 0' }}>
              {a.conductor?.telefono && (
                <a className="boton" href={`tel:${a.conductor.telefono.replace(/[^0-9+]/g, '')}`}>Llamar al chofer</a>
              )}
              {enlaceWhatsApp(a.conductor?.telefono) && (
                <a className="boton secundario" href={enlaceWhatsApp(a.conductor?.telefono)!} target="_blank" rel="noreferrer">WhatsApp</a>
              )}
              {a.ultima_lat !== null && a.ultima_lon !== null && (
                <a className="boton secundario" href={`https://www.google.com/maps?q=${a.ultima_lat},${a.ultima_lon}`} target="_blank" rel="noreferrer">
                  Abrir ubicación en Google Maps
                </a>
              )}
            </div>
            <FormularioAccion accion={atenderEmergencia.bind(null, a.id, id)} boton="Marcar como atendida" claseBoton="boton secundario">
              <label>¿Qué se hizo? (obligatorio)<input name="nota" required placeholder="Ej. se llamó al chofer, está bien; se envió mecánico" /></label>
            </FormularioAccion>
          </div>
        )}
        {(a.tramo ?? 1) > 1 && a.etapa !== 'cancelado' && (
          <details className="agregar no-imprimir" style={{ marginBottom: 12 }}>
            <summary>Toneladas declaradas de este camión</summary>
            <FormularioAccion accion={fijarToneladasDeclaradas.bind(null, a.id, id)} boton="Guardar toneladas" claseBoton="boton secundario">
              <label>Toneladas declaradas en el transbordo<input name="toneladas_declaradas" inputMode="decimal" defaultValue={a.toneladas_declaradas ?? ''} /></label>
            </FormularioAccion>
          </details>
        )}
        {!cerrada && (
          <div className="no-imprimir" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
            <div>
              <h3>Acceso del chofer</h3>
              <InvitacionChofer
                nombreChofer={a.conductor?.nombre ?? ''}
                telefonoChofer={a.conductor?.telefono ?? null}
                codigoMision={m.codigo}
                generar={crearInvitacion.bind(null, a.id)}
                vigente={invitacionDe(a.id)}
              />
            </div>
            <div>
              <h3>Modo manual (si falla la app)</h3>
              <FormularioAccion accion={cambiarEtapaManual.bind(null, a.id, id)} boton="Cambiar etapa" claseBoton="boton secundario" confirmarCierre>
                <div className="rejilla">
                  <label>
                    Nueva etapa
                    <select name="etapa" defaultValue={a.etapa}>
                      {ETAPAS.map((e) => <option key={e} value={e}>{ETIQUETA_ETAPA[e]}</option>)}
                    </select>
                  </label>
                  <label>Nota (obligatoria para Entregado o Cancelado)<input name="nota" placeholder="Ej. chofer avisó por teléfono" /></label>
                </div>
              </FormularioAccion>
            </div>
          </div>
        )}
      </section>
    );
  };

  return (
    <>
      <section className="tarjeta">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ margin: 0 }}>Misión {m.codigo}</h1>
            <span className="no-imprimir"><IndicadorDocumentos claves={documentos.map((d) => claveDe(d.tipo, d.etiqueta))} pais={m.destino?.pais} /></span>
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="no-imprimir"><RefrescoEnVivo misionId={id} /></span>
            <BotonImprimir />
            <span className={`etiqueta ${m.etapa}`}>{transbordoEnCurso ? 'En transbordo' : ETIQUETA_ETAPA[m.etapa]}</span>
          </div>
        </div>
        <p>
          <strong>{m.cliente?.razon_social}</strong> · {m.origen?.nombre} → {m.destino?.nombre} ({m.destino?.pais})
          <br />
          Factura {m.factura ?? '—'} · Guía {m.guia ?? '—'} · DEX {m.dex ?? '—'} · {m.tipo_carga ?? ''}{' '}
          {m.tonelaje_objetivo ? `· ${m.tonelaje_objetivo} TN objetivo` : ''}
        </p>
        {m.telefono_coordinador && <p style={{ fontSize: 14 }}>Coordinador: {m.telefono_coordinador}</p>}
        {m.entrega_comprometida && <p style={{ fontSize: 14 }}>Entrega comprometida: {formatoHora(m.entrega_comprometida)}</p>}
        {m.notas && <p style={{ fontSize: 14 }}>Notas: {m.notas}</p>}
        <details className="agregar no-imprimir" style={{ marginBottom: 12 }}>
          <summary>Editar datos de la misión</summary>
          <FormularioAccion accion={editarMision.bind(null, id)} boton="Guardar cambios">
            <div className="rejilla">
              <label>N.º de factura<input name="factura" defaultValue={m.factura ?? ''} /></label>
              <label>N.º de guía<input name="guia" defaultValue={m.guia ?? ''} /></label>
              <label>N.º de DEX<input name="dex" defaultValue={m.dex ?? ''} /></label>
              <label>Tipo de carga<input name="tipo_carga" defaultValue={m.tipo_carga ?? ''} /></label>
              <label>Tonelaje objetivo (TN)<input name="tonelaje_objetivo" inputMode="decimal" defaultValue={m.tonelaje_objetivo ?? ''} /></label>
              <label>WhatsApp del coordinador<input name="telefono_coordinador" defaultValue={m.telefono_coordinador ?? ''} placeholder="+591…" /></label>
              <label>Entrega comprometida (hora de Bolivia)<input name="entrega_comprometida" type="datetime-local" defaultValue={aFechaHoraBolivia(m.entrega_comprometida)} /></label>
            </div>
            <label>Notas<textarea name="notas" rows={2} defaultValue={m.notas ?? ''} /></label>
          </FormularioAccion>
        </details>
        <BarraEtapas etapa={m.etapa} destinoPais={m.destino?.pais} horas={horasEtapa} />
        <MapaMision asignaciones={asignaciones} recorridos={recorridos} />
      </section>

      {m.etapa !== 'cancelado' && (
        <section className="tarjeta no-imprimir">
          <h2>Seguimiento para el cliente</h2>
          <EnlaceCliente
            codigoMision={m.codigo}
            nombreCliente={m.cliente?.razon_social ?? null}
            whatsappCliente={m.cliente?.whatsapp ?? null}
            vigente={enlaceCliente}
            generar={crearEnlaceSeguimiento.bind(null, id)}
            anular={anularEnlaceSeguimiento.bind(null, id)}
          />
        </section>
      )}

      {Array.from({ length: ultimoTramo }, (_, i) => i + 1).map((n) => {
        const delTramo = asignaciones.filter((a) => (a.tramo ?? 1) === n);
        const tramo = tramos.find((t) => t.numero === n) ?? null;
        const siguiente = tramos.find((t) => t.numero === n + 1) ?? null;
        const declaradas = delTramo.filter((a) => a.etapa !== 'cancelado').reduce((t, a) => t + (a.toneladas_declaradas ?? 0), 0);
        const diferencia = n > 1 && tnFabrica > 0 && declaradas > 0 ? Math.abs(declaradas - tnFabrica) / tnFabrica : null;
        return (
          <div key={n}>
            {ultimoTramo > 1 && (
              <section className="tarjeta tramo-encabezado">
                <h2 style={{ margin: 0 }}>
                  Tramo {n}: {n === 1 ? m.origen?.nombre : tramo?.lugar_inicio ?? 'punto de transbordo'} →{' '}
                  {siguiente ? `transbordo${siguiente.lugar_inicio ? ` en ${siguiente.lugar_inicio}` : ''}` : `${m.destino?.nombre} (${m.destino?.pais})`}
                </h2>
                {n === 1 ? (
                  <p style={{ fontSize: 14, margin: '4px 0 0' }}>Pesado en fábrica: <strong>{tnFabrica.toLocaleString('es-BO')} TN</strong></p>
                ) : (
                  <>
                    <p style={{ fontSize: 14, margin: '4px 0 0' }}>
                      Empresa: <strong>{tramo?.transportista?.razon_social ?? 'sin definir'}</strong>
                      {delTramo.length === 0 && ' · sin camiones aún'} · Declarado:{' '}
                      <strong>{declaradas.toLocaleString('es-BO')} de {tnFabrica.toLocaleString('es-BO')} TN</strong>
                    </p>
                    {diferencia !== null && diferencia > TOLERANCIA_PESO && (
                      <p className="alerta" role="alert">
                        La diferencia con lo pesado en fábrica es de {(diferencia * 100).toFixed(1)} %; el máximo permitido es 0,5 %. Revise las toneladas declaradas.
                      </p>
                    )}
                    {tramo && m.etapa !== 'entregado' && m.etapa !== 'cancelado' && (
                      <details className="agregar no-imprimir">
                        <summary>Corregir empresa o lugar del transbordo</summary>
                        <FormularioAccion accion={editarTramo.bind(null, id, tramo.id)} boton="Guardar tramo" claseBoton="boton secundario">
                          <div className="rejilla">
                            <label>
                              Empresa del tramo
                              <select name="transportista_tramo" defaultValue={tramo.transportista_id ?? ''}>
                                <option value="">Sin definir</option>
                                {catalogos.transportistas.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                              </select>
                            </label>
                            <label>Lugar del transbordo<input name="lugar_tramo" defaultValue={tramo.lugar_inicio ?? ''} /></label>
                          </div>
                        </FormularioAccion>
                      </details>
                    )}
                  </>
                )}
              </section>
            )}
            {delTramo.map(tarjetaCamion)}
            {(ultimoTramo === 1 || (m.etapa !== 'entregado' && m.etapa !== 'cancelado')) && (
              <section className="tarjeta no-imprimir">
                <details className="agregar" open={delTramo.length === 0 && n === 1}>
                  <summary>+ Agregar {delTramo.length === 0 ? 'un camión' : 'otro camión'}{ultimoTramo > 1 ? ` al tramo ${n}` : ''}</summary>
                  <FormularioAccion accion={agregarCamion.bind(null, id, n)} boton="Agregar camión">
                    <CamposCamion catalogos={catalogos} transportistaInicial={n > 1 ? tramo?.transportista_id : undefined} declaradas={n > 1} />
                  </FormularioAccion>
                </details>
              </section>
            )}
          </div>
        );
      })}

      {puedeAgregarTransbordo && (
        <section className="tarjeta no-imprimir">
          <details className="agregar">
            <summary>+ Agregar un transbordo (la carga pasa a otro camión en el camino)</summary>
            <p className="ayuda">
              Se crea el tramo {ultimoTramo + 1}. Los camiones del tramo {ultimoTramo} terminarán con «Entregado en transbordo».
              Los camiones del nuevo tramo se agregan cuando los conozca.
            </p>
            <FormularioAccion accion={agregarTransbordo.bind(null, id, ultimoTramo + 1)} boton="Agregar transbordo">
              <div className="rejilla">
                <label>
                  Empresa que hará el tramo {ultimoTramo + 1}
                  <select name="transportista_tramo" required defaultValue="">
                    <option value="" disabled>Seleccione…</option>
                    {catalogos.transportistas.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                  </select>
                </label>
                <label>Lugar aproximado del transbordo<input name="lugar_tramo" placeholder="Ej. El Alto, zona Senkata" /></label>
              </div>
            </FormularioAccion>
          </details>
        </section>
      )}

      <section className="tarjeta no-imprimir">
        <h2>Documentos</h2>
        <ListaDocumentos documentos={documentos} />
        {m.etapa !== 'cancelado' && (
          <details className="agregar" style={{ marginTop: 12 }}>
            <summary>+ Subir documento</summary>
            <SubirDocumento
              misionId={id}
              tipos={CLAVES_DESPACHO}
              camiones={asignaciones.filter((a) => a.etapa !== 'cancelado').map((a) => ({ id: a.id, placa: a.vehiculo?.placa ?? '' }))}
              reemplazables={documentos.map((d) => ({ id: d.id, texto: `${nombreDocumento(d.tipo, d.etiqueta)}${d.numero ? ` ${d.numero}` : ''} · ${d.placa ?? 'toda la carga'}` }))}
              registrar={registrarDocumentoDespacho.bind(null, id)}
            />
          </details>
        )}
        {accesos.length > 0 && (
          <details className="agregar" style={{ marginTop: 12 }}>
            <summary>Quién abrió los documentos ({accesos.length === 20 ? 'últimos 20' : accesos.length})</summary>
            <ul className="lista-accesos">
              {accesos.map((a) => (
                <li key={a.id}>
                  {formatoHora(a.descargado_en)} · {a.operador ? `${a.operador.nombre} (transbordo)` : nombrePersonal(a.usuario_id)} abrió{' '}
                  {nombreDocumento(a.documento.tipo, a.documento.etiqueta)}{a.documento.numero ? ` N.º ${a.documento.numero}` : ''}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section className="tarjeta">
        <h2>Eventos</h2>
        <div className="tabla-desplazable"><table>
          <thead><tr><th>Hora</th><th>Camión</th><th>Qué pasó</th></tr></thead>
          <tbody>
            {eventos.map((e) => (
              <tr
                key={e.id}
                className={[
                  e.tipo === 'emergencia' || e.tipo === 'incidencia' ? 'evento-alerta' : '',
                  // El PDF puede llegar al cliente: no lleva alertas internas, activaciones ni emergencias.
                  e.tipo === 'cambio_etapa' ? '' : 'no-imprimir',
                ].filter(Boolean).join(' ') || undefined}
              >
                <td style={{ whiteSpace: 'nowrap' }}>{formatoHora(e.ocurrido_en)}</td>
                <td>{placaDe(e.asignacion_id)}</td>
                <td>
                  {describirEvento(e, choferDe(e.asignacion_id), intermedio(e.asignacion_id))}
                  {e.detalle?.hora_ajustada === true && e.hora_dispositivo && (
                    <span className="ayuda" style={{ display: 'block', margin: 0 }}>
                      Hora informada por el teléfono: {formatoHora(e.hora_dispositivo)} (anterior al paso previo; se ordenó después de él).
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
        {eventos.length === 0 && <p>Sin eventos todavía.</p>}
      </section>
    </>
  );
}
