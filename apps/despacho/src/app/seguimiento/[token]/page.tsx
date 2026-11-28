import type { Metadata } from 'next';
import { createClient } from '@supabase/supabase-js';
import { ETIQUETA_ETAPA, type Etapa } from '@reynales/shared';
import BarraEtapas from '@/componentes/BarraEtapas';
import MapaSeguimiento from '@/componentes/MapaSeguimiento';
import RefrescoPeriodico from '@/componentes/RefrescoPeriodico';
import { enlaceWhatsApp, FACTOR_CARRETERA, formatoHora, haceCuanto } from '@/lib/tipos';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Seguimiento de su carga · Industrias Reynales',
  robots: { index: false, follow: false },
  referrer: 'strict-origin-when-cross-origin',
};

interface CamionPublico {
  nombre: string;
  etapa: Etapa;
  toneladas: number | null;
  parado: boolean;
  lat: number | null;
  lon: number | null;
  zona: string | null;
  hora_posicion: string | null;
  km_al_destino: number | null;
  entregado_en: string | null;
}

interface Seguimiento {
  codigo: string;
  etapa: Etapa;
  cliente: string | null;
  origen: string;
  destino: string;
  destino_pais: string;
  destino_lat: number;
  destino_lon: number;
  zona_horaria: string;
  factura: string | null;
  guia: string | null;
  dex: string | null;
  tipo_carga: string | null;
  tonelaje_objetivo: number | null;
  telefono_contacto: string | null;
  retraso_min: number;
  camiones: CamionPublico[];
  hitos: { etapa: Etapa; hora: string }[];
  consultado_en: string;
}

// Rango de llegada: velocidad promedio optimista y prudente de un camión cargado (km/h).
const VELOCIDAD_RAPIDA = 55;
const VELOCIDAD_LENTA = 35;
// Con datos más viejos que esto no se estima la llegada.
const MAX_HORAS_SIN_DATOS = 2;

/** Rango estimado de llegada (o null si no hay datos recientes). */
function rangoLlegada(c: CamionPublico): { desde: string; hasta: string } | null {
  if (c.km_al_destino === null || !c.hora_posicion) return null;
  const base = new Date(c.hora_posicion).getTime();
  if (Date.now() - base > MAX_HORAS_SIN_DATOS * 3600_000) return null;
  const km = c.km_al_destino * FACTOR_CARRETERA;
  return {
    desde: new Date(base + (km / VELOCIDAD_RAPIDA) * 3600_000).toISOString(),
    hasta: new Date(base + (km / VELOCIDAD_LENTA) * 3600_000).toISOString(),
  };
}

async function consultar(token: string): Promise<Seguimiento | null> {
  // Cliente anónimo sin sesión ni cookies: solo puede llamar a la consulta pública.
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.rpc('seguimiento_publico', { p_token: token });
  if (error || !data) return null;
  return data as Seguimiento;
}

function Encabezado() {
  return (
    <header className="seg-encabezado">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.png" alt="Industrias Reynales" />
      <span>Seguimiento de su carga</span>
    </header>
  );
}

export default async function PaginaSeguimiento({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const s = await consultar(token);

  if (!s) {
    return (
      <main className="seg-pagina">
        <Encabezado />
        <section className="tarjeta">
          <h1>Este enlace ya no está disponible</h1>
          <p>
            El seguimiento termina 48 horas después de la entrega, o cuando Industrias Reynales anula el enlace.
            Si necesita información sobre su envío, comuníquese con su contacto en Industrias Reynales.
          </p>
        </section>
      </main>
    );
  }

  const zona = s.zona_horaria;
  const nombreZona = zona === 'America/Lima' ? 'hora de Perú' : 'hora de Bolivia';
  const horas: Partial<Record<Etapa, string>> = {};
  for (const h of s.hitos) horas[h.etapa] = h.hora;
  const enViaje = (e: Etapa) => e === 'cargado' || e === 'en_ruta' || e === 'en_frontera' || e === 'cruzo_frontera';
  const conMapa = s.camiones.some((c) => enViaje(c.etapa));
  const totalTn = s.camiones.reduce((t, c) => t + (c.toneladas ?? 0), 0);
  const entregados = s.camiones.filter((c) => c.etapa === 'entregado').length;
  const whatsapp = enlaceWhatsApp(
    s.telefono_contacto,
    `Hola, le escribo por el envío ${s.codigo}${s.cliente ? ` de ${s.cliente}` : ''}.`,
  );

  return (
    <main className="seg-pagina">
      <RefrescoPeriodico segundos={120} />
      <Encabezado />

      <section className="tarjeta">
        <div className="seg-titulo">
          <h1>Envío {s.codigo}</h1>
          <span className={`etiqueta ${s.etapa}`}>{ETIQUETA_ETAPA[s.etapa]}</span>
        </div>
        <p className="seg-ruta">
          {s.cliente && <><strong>{s.cliente}</strong><br /></>}
          {s.origen} → {s.destino}
        </p>
        <BarraEtapas etapa={s.etapa} destinoPais={s.destino_pais} horas={horas} zona={zona} />
        <dl className="seg-datos">
          {s.factura && <><dt>Factura</dt><dd>{s.factura}</dd></>}
          {s.guia && <><dt>Guía</dt><dd>{s.guia}</dd></>}
          {s.dex && <><dt>DEX</dt><dd>{s.dex}</dd></>}
          {s.tipo_carga && <><dt>Carga</dt><dd>{s.tipo_carga}</dd></>}
          <dt>Toneladas</dt>
          <dd>
            {totalTn > 0 ? `${totalTn.toLocaleString('es-BO')} TN cargadas` : 'Por pesar en fábrica'}
            {s.tonelaje_objetivo ? ` de ${s.tonelaje_objetivo.toLocaleString('es-BO')} TN` : ''}
          </dd>
          <dt>Camiones</dt>
          <dd>{s.camiones.length}{entregados > 0 && entregados < s.camiones.length ? ` (${entregados} ya entregados)` : ''}</dd>
        </dl>
      </section>

      {conMapa && (
        <section className="tarjeta">
          <h2>Dónde está su carga</h2>
          <p className="ayuda">
            Ubicación aproximada, con {s.retraso_min} minutos de retraso por seguridad de la carga.
            {s.camiones.some((c) => c.parado && c.lat !== null) && ' Si un camión está detenido, se muestra solo la zona donde se encuentra.'}
          </p>
          <MapaSeguimiento
            camiones={s.camiones.map((c) => ({ nombre: c.nombre, etapa: c.etapa, parado: c.parado, lat: c.lat, lon: c.lon }))}
            destino={{ lat: s.destino_lat, lon: s.destino_lon, nombre: s.destino }}
          />
        </section>
      )}

      <section className="tarjeta">
        <h2>Camiones</h2>
        <ul className="seg-camiones">
          {s.camiones.map((c, i) => {
            const rango = enViaje(c.etapa) ? rangoLlegada(c) : null;
            return (
              <li key={`${c.nombre}-${i}`}>
                <div className="seg-titulo">
                  <strong>{c.nombre}</strong>
                  <span className={`etiqueta ${c.etapa}`}>{ETIQUETA_ETAPA[c.etapa]}</span>
                </div>
                {c.toneladas !== null && <div>{c.toneladas.toLocaleString('es-BO')} TN cargadas</div>}
                {c.etapa === 'programado' && <div>Aún no inicia el viaje.</div>}
                {c.etapa === 'entregado' && <div>Entregado el {formatoHora(c.entregado_en, zona)} ({nombreZona}).</div>}
                {enViaje(c.etapa) && (
                  <>
                    {c.parado && c.zona && <div>Detenido {c.zona}.</div>}
                    {c.km_al_destino !== null && <div>A unos {Math.round(c.km_al_destino * FACTOR_CARRETERA)} km del destino por carretera (aprox.).</div>}
                    {rango ? (
                      <div>
                        Llegada estimada: <strong>entre {formatoHora(rango.desde, zona)} y {formatoHora(rango.hasta, zona)}</strong> ({nombreZona})
                        {s.destino_pais === 'PE' && (c.etapa === 'cargado' || c.etapa === 'en_ruta' || c.etapa === 'en_frontera') && ', sin contar la espera en frontera'}.
                      </div>
                    ) : (
                      <div className="ayuda" style={{ margin: 0 }}>
                        {c.hora_posicion
                          ? `El camión pasa por una zona sin cobertura; última actualización ${haceCuanto(c.hora_posicion)}. La información se actualizará cuando recupere señal.`
                          : 'Todavía no hay ubicación disponible para este camión.'}
                      </div>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="tarjeta seg-contacto">
        {whatsapp ? (
          <a className="boton" href={whatsapp} target="_blank" rel="noreferrer">Escribir al coordinador por WhatsApp</a>
        ) : (
          <p>Para consultas, comuníquese con su contacto en Industrias Reynales.</p>
        )}
        <p className="ayuda">
          Actualizado: {formatoHora(s.consultado_en, zona)} ({nombreZona}). Esta página se actualiza sola cada 2 minutos.
        </p>
      </section>
    </main>
  );
}
