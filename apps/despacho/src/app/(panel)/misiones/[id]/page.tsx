import { notFound } from 'next/navigation';
import { ETAPAS, ETIQUETA_ETAPA, type Etapa } from '@reynales/shared';
import { crearClienteServidor } from '@/lib/supabase/server';
import { cargarCatalogosCamion } from '@/lib/catalogos';
import { SELECT_ASIGNACION_EN_VIVO } from '@/lib/consultas';
import { formatoHora, minutosSinSenal, type AsignacionEnVivo } from '@/lib/tipos';
import CamposCamion from '@/componentes/CamposCamion';
import FormularioAccion from '@/componentes/FormularioAccion';
import InvitacionChofer from '@/componentes/InvitacionChofer';
import MapaMision from '@/componentes/MapaMision';
import { agregarCamion, cambiarEtapaManual, crearInvitacion } from '../acciones';

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
    supabase.from('asignaciones').select(`${SELECT_ASIGNACION_EN_VIVO}, conductor_det:conductores(telefono)`).eq('mision_id', id).order('creado_en'),
    cargarCatalogosCamion(),
  ]);
  const asignaciones = (asigData ?? []) as unknown as (AsignacionEnVivo & { conductor_det: { telefono: string | null } | null })[];
  const ids = asignaciones.map((a) => a.id);

  const { data: eventosData } = ids.length
    ? await supabase.from('eventos').select('id, asignacion_id, tipo, etapa_nueva, origen, ocurrido_en, detalle')
        .in('asignacion_id', ids).order('ocurrido_en', { ascending: false }).limit(50)
    : { data: [] };
  const eventos = (eventosData ?? []) as Evento[];

  // Recorrido del primer camión con señal (para la línea en el mapa).
  const conSenal = asignaciones.find((a) => a.ultima_senal);
  let recorrido: [number, number][] = [];
  if (conSenal) {
    const { data } = await supabase.rpc('recorrido_asignacion', { p_asignacion: conSenal.id, p_limite: 2000 });
    recorrido = ((data ?? []) as { lat: number; lon: number }[]).map((p) => [p.lat, p.lon]);
  }

  const m = mision as unknown as {
    codigo: string; etapa: Etapa; factura: string | null; guia: string | null; dex: string | null;
    tipo_carga: string | null; tonelaje_objetivo: number | null; telefono_coordinador: string | null; notas: string | null;
    cliente: { razon_social: string; pais: string } | null; origen: { nombre: string } | null; destino: { nombre: string; pais: string } | null;
  };
  const placaDe = (asigId: string) => asignaciones.find((a) => a.id === asigId)?.vehiculo?.placa ?? '';

  return (
    <>
      <section className="tarjeta">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ margin: 0 }}>Misión {m.codigo}</h1>
          <span className={`etiqueta ${m.etapa}`}>{ETIQUETA_ETAPA[m.etapa]}</span>
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
          <section key={a.id} className="tarjeta">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0 }}>{a.vehiculo?.placa} · {a.conductor?.nombre}</h2>
              <span className={`etiqueta ${a.etapa}`}>{ETIQUETA_ETAPA[a.etapa]}</span>
            </div>
            <p style={{ fontSize: 14 }}>
              Última señal: {formatoHora(a.ultima_senal)} {min !== null && `(hace ${min} min)`} ·{' '}
              {a.ultima_velocidad_kmh ?? 0} km/h · {a.toneladas_cargadas ? `${a.toneladas_cargadas} TN cargadas` : 'TN sin registrar'}
            </p>
            {!cerrada && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
                <div>
                  <h3>Acceso del chofer</h3>
                  <InvitacionChofer
                    nombreChofer={a.conductor?.nombre ?? ''}
                    telefonoChofer={a.conductor_det?.telefono ?? null}
                    codigoMision={m.codigo}
                    generar={crearInvitacion.bind(null, a.id)}
                  />
                </div>
                <div>
                  <h3>Modo manual (si falla la app)</h3>
                  <FormularioAccion accion={cambiarEtapaManual.bind(null, a.id, id)} boton="Cambiar etapa" claseBoton="boton secundario">
                    <div className="rejilla">
                      <label>
                        Nueva etapa
                        <select name="etapa" defaultValue={a.etapa}>
                          {ETAPAS.map((e) => <option key={e} value={e}>{ETIQUETA_ETAPA[e]}</option>)}
                        </select>
                      </label>
                      <label>Nota<input name="nota" placeholder="Ej. chofer avisó por teléfono" /></label>
                    </div>
                  </FormularioAccion>
                </div>
              </div>
            )}
          </section>
        );
      })}

      <section className="tarjeta">
        <h2>Agregar otro camión</h2>
        <FormularioAccion accion={agregarCamion.bind(null, id)} boton="Agregar camión">
          <CamposCamion catalogos={catalogos} />
        </FormularioAccion>
      </section>

      <section className="tarjeta">
        <h2>Eventos</h2>
        <table>
          <thead><tr><th>Hora</th><th>Camión</th><th>Evento</th><th>Origen</th><th>Detalle</th></tr></thead>
          <tbody>
            {eventos.map((e) => (
              <tr key={e.id}>
                <td>{formatoHora(e.ocurrido_en)}</td>
                <td>{placaDe(e.asignacion_id)}</td>
                <td>{e.etapa_nueva ? ETIQUETA_ETAPA[e.etapa_nueva] : e.tipo}</td>
                <td>{e.origen}</td>
                <td style={{ fontSize: 12, color: 'var(--gris)' }}>{Object.entries(e.detalle).map(([k, v]) => `${k}: ${String(v)}`).join(' · ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {eventos.length === 0 && <p>Sin eventos todavía.</p>}
      </section>
    </>
  );
}
