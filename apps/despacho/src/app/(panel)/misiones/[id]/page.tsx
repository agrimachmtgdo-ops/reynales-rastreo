import { notFound } from 'next/navigation';
import { ETAPAS, ETIQUETA_ETAPA, type Etapa } from '@reynales/shared';
import { crearClienteServidor } from '@/lib/supabase/server';
import { cargarCatalogosCamion } from '@/lib/catalogos';
import { SELECT_ASIGNACION_EN_VIVO } from '@/lib/consultas';
import { enlaceWhatsApp, formatoHora, minutosSinSenal, textoEmergencia, type AsignacionEnVivo } from '@/lib/tipos';
import CamposCamion from '@/componentes/CamposCamion';
import FormularioAccion from '@/componentes/FormularioAccion';
import InvitacionChofer from '@/componentes/InvitacionChofer';
import MapaMision from '@/componentes/MapaMision';
import RefrescoEnVivo from '@/componentes/RefrescoEnVivo';
import { agregarCamion, atenderEmergencia, cambiarEtapaManual, crearInvitacion } from '../acciones';

export const dynamic = 'force-dynamic';

interface Evento {
  id: string;
  asignacion_id: string;
  tipo: string;
  etapa_nueva: Etapa | null;
  origen: string;
  ocurrido_en: string;
  detalle: Record<string, unknown>;
}

const nombreEtapa = (etapa: unknown) => (typeof etapa === 'string' ? ETIQUETA_ETAPA[etapa as Etapa] ?? etapa : '');

/** Convierte un evento en una frase que despacho entienda sin conocer el sistema. */
function describirEvento(e: Evento, chofer: string): string {
  const d = e.detalle ?? {};
  const antes = d.etapa_anterior ? ` (antes: ${nombreEtapa(d.etapa_anterior)})` : '';
  if (e.tipo === 'cambio_etapa' && e.etapa_nueva) {
    const etapa = `«${nombreEtapa(e.etapa_nueva)}»`;
    if (e.origen === 'chofer') return `${chofer} marcó ${etapa} desde la app${antes}.`;
    if (e.origen === 'despacho') return `Despacho cambió la etapa a ${etapa}${antes}${d.nota ? `. Nota: ${String(d.nota)}` : ''}.`;
    if (d.motivo === 'salio_de_origen') return `El sistema detectó que el camión salió de fábrica: ${etapa}${antes}.`;
    if (d.motivo === 'cruce_sin_parada') return `El sistema detectó que el camión cruzó a Perú por ${String(d.frontera)} sin detenerse en la frontera${antes}.`;
    if (d.frontera) return `El sistema detectó ${etapa} en ${String(d.frontera)}${antes}.`;
    return `El sistema cambió la etapa a ${etapa}${antes}.`;
  }
  if (e.tipo === 'incidencia' && d.motivo === 'ubicacion_simulada') {
    return `Alerta: el teléfono envió ${String(d.cantidad ?? 'algunas')} ubicaciones simuladas (posible GPS falso). Se descartaron.`;
  }
  if (e.tipo === 'emergencia') {
    const donde = typeof d.lat === 'number' && typeof d.lon === 'number' ? ` Ubicación: ${d.lat.toFixed(5)}, ${d.lon.toFixed(5)}.` : ' Sin ubicación.';
    return `EMERGENCIA reportada por ${chofer} desde la app: ${textoEmergencia(d.motivo as string)}.${donde}`;
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
    .select(`id, codigo, etapa, factura, guia, dex, tipo_carga, tonelaje_objetivo, telefono_coordinador, notas,
             cliente:clientes(razon_social, pais),
             origen:ubicaciones!misiones_origen_id_fkey(nombre),
             destino:ubicaciones!misiones_destino_id_fkey(nombre, pais)`)
    .eq('id', id)
    .maybeSingle();
  if (!mision) notFound();

  const [{ data: asigData }, catalogos] = await Promise.all([
    supabase.from('asignaciones').select(SELECT_ASIGNACION_EN_VIVO).eq('mision_id', id).order('creado_en'),
    cargarCatalogosCamion(),
  ]);
  const asignaciones = (asigData ?? []) as unknown as AsignacionEnVivo[];
  const ids = asignaciones.map((a) => a.id);

  // Invitación más reciente (no anulada) de cada camión, para mostrarla al recargar la página.
  const { data: invitacionesData } = ids.length
    ? await supabase.from('invitaciones_chofer').select('asignacion_id, codigo, vence_en, usado_en, creado_en')
        .in('asignacion_id', ids).eq('revocada', false).order('creado_en', { ascending: false })
    : { data: [] };
  const invitacionDe = (asigId: string) =>
    ((invitacionesData ?? []) as { asignacion_id: string; codigo: string; vence_en: string; usado_en: string | null }[])
      .find((i) => i.asignacion_id === asigId) ?? null;

  const { data: eventosData } = ids.length
    ? await supabase.from('eventos').select('id, asignacion_id, tipo, etapa_nueva, origen, ocurrido_en, detalle')
        .in('asignacion_id', ids).order('ocurrido_en', { ascending: false }).limit(50)
    : { data: [] };
  const eventos = (eventosData ?? []) as Evento[];

  // Recorrido completo (simplificado) del primer camión con señal, para la línea en el mapa.
  const conSenal = asignaciones.find((a) => a.ultima_senal);
  let recorrido: [number, number][] = [];
  if (conSenal) {
    const { data } = await supabase.rpc('recorrido_simplificado', { p_asignacion: conSenal.id, p_tolerancia_m: 25 });
    recorrido = ((data ?? []) as { lat: number; lon: number }[]).map((p) => [p.lat, p.lon]);
  }

  const m = mision as unknown as {
    codigo: string; etapa: Etapa; factura: string | null; guia: string | null; dex: string | null;
    tipo_carga: string | null; tonelaje_objetivo: number | null; telefono_coordinador: string | null; notas: string | null;
    cliente: { razon_social: string; pais: string } | null; origen: { nombre: string } | null; destino: { nombre: string; pais: string } | null;
  };
  const placaDe = (asigId: string) => asignaciones.find((a) => a.id === asigId)?.vehiculo?.placa ?? '';
  const choferDe = (asigId: string) => asignaciones.find((a) => a.id === asigId)?.conductor?.nombre ?? 'El chofer';

  return (
    <>
      <section className="tarjeta">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ margin: 0 }}>Misión {m.codigo}</h1>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <RefrescoEnVivo misionId={id} />
            <span className={`etiqueta ${m.etapa}`}>{ETIQUETA_ETAPA[m.etapa]}</span>
          </div>
        </div>
        <p>
          <strong>{m.cliente?.razon_social}</strong> · {m.origen?.nombre} → {m.destino?.nombre} ({m.destino?.pais})
          <br />
          Factura {m.factura ?? '—'} · Guía {m.guia ?? '—'} · DEX {m.dex ?? '—'} · {m.tipo_carga ?? ''}{' '}
          {m.tonelaje_objetivo ? `· ${m.tonelaje_objetivo} TN objetivo` : ''}
        </p>
        <MapaMision asignaciones={asignaciones} recorrido={recorrido} />
      </section>

      {asignaciones.map((a) => {
        const min = minutosSinSenal(a.ultima_senal);
        const cerrada = a.etapa === 'entregado' || a.etapa === 'cancelado';
        return (
          <section key={a.id} className={`tarjeta${a.emergencia_en ? ' emergencia' : ''}`}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0 }}>{a.vehiculo?.placa} · {a.conductor?.nombre}</h2>
              <span className={`etiqueta ${a.etapa}`}>{ETIQUETA_ETAPA[a.etapa]}</span>
            </div>
            <p style={{ fontSize: 14 }}>
              Última señal: {formatoHora(a.ultima_senal)} {min !== null && `(hace ${min} min)`} ·{' '}
              {a.ultima_velocidad_kmh ?? 0} km/h · {a.toneladas_cargadas ? `${a.toneladas_cargadas} TN cargadas` : 'TN sin registrar'}
            </p>
            {a.emergencia_en && (
              <div className="aviso-emergencia" role="alert">
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
            {!cerrada && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
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
      })}

      <section className="tarjeta">
        <details className="agregar" open={asignaciones.length === 0}>
          <summary>+ Agregar {asignaciones.length === 0 ? 'un camión' : 'otro camión'}</summary>
          <FormularioAccion accion={agregarCamion.bind(null, id)} boton="Agregar camión">
            <CamposCamion catalogos={catalogos} />
          </FormularioAccion>
        </details>
      </section>

      <section className="tarjeta">
        <h2>Eventos</h2>
        <table>
          <thead><tr><th>Hora</th><th>Camión</th><th>Qué pasó</th></tr></thead>
          <tbody>
            {eventos.map((e) => (
              <tr key={e.id} className={e.tipo === 'emergencia' || e.tipo === 'incidencia' ? 'evento-alerta' : undefined}>
                <td style={{ whiteSpace: 'nowrap' }}>{formatoHora(e.ocurrido_en)}</td>
                <td>{placaDe(e.asignacion_id)}</td>
                <td>{describirEvento(e, choferDe(e.asignacion_id))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {eventos.length === 0 && <p>Sin eventos todavía.</p>}
      </section>
    </>
  );
}
