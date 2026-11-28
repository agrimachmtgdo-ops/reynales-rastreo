'use client';
import { useEffect, useRef } from 'react';
import L, { type Map as LeafletMap } from 'leaflet';
import { MapContainer, TileLayer, CircleMarker, Popup, Polyline, Tooltip, useMap } from 'react-leaflet';
import { ETIQUETA_ETAPA, MARCA } from '@reynales/shared';
import { estaDetenido, formatoHora, haceCuanto, minutosSinSenal, MINUTOS_DETENIDO, textoEmergencia, type AsignacionEnVivo } from '@/lib/tipos';

// Centro inicial: entre Monteagudo y Desaguadero.
const CENTRO: [number, number] = [-17.6, -66.5];
const AZUL = '#1d4f80';
// Color propio para «Detenido» (en ruta pero sin moverse).
export const MORADO_DETENIDO = '#7d3c98';
const GRIS_SIN_SENAL = '#8a8a8a';
const CAFE_POR_INICIAR = '#c9b79c';
// Un color por camión en el detalle de misión.
const COLORES_RECORRIDO = [MARCA.cafe, '#1d4f80', '#8e44ad', '#d35400', '#16a085'];

function color(a: AsignacionEnVivo, minDetenido: number) {
  if (a.emergencia_en) return MARCA.rojo;
  if (a.etapa === 'programado') return CAFE_POR_INICIAR;
  if (a.etapa === 'entregado' || a.etapa === 'cancelado') return MARCA.verdeOscuro;
  const min = minutosSinSenal(a.ultima_senal);
  if (min === null || min > 30) return GRIS_SIN_SENAL;
  if (estaDetenido(a, Date.now(), minDetenido)) return MORADO_DETENIDO;
  const etapa = a.etapa;
  if (etapa === 'en_frontera') return MARCA.dorado;
  if (etapa === 'cruzo_frontera') return AZUL;
  return MARCA.verde;
}

/** Vuela al camión solo cuando cambia la selección (no en cada actualización de posición). */
function Enfocar({ seleccion, lat, lon }: { seleccion: string | null | undefined; lat: number | null; lon: number | null }) {
  const mapa = useMap();
  useEffect(() => {
    if (seleccion && lat !== null && lon !== null) mapa.flyTo([lat, lon], Math.max(mapa.getZoom(), 13), { duration: 0.8 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapa, seleccion]);
  return null;
}

/** Muestra a todos los camiones con posición. */
function encuadrar(mapa: LeafletMap, puntos: [number, number][]) {
  mapa.invalidateSize(); // el contenedor pudo cambiar de tamaño al cargar la página
  if (puntos.length === 1) mapa.setView(puntos[0]!, 13);
  else if (puntos.length > 1) mapa.fitBounds(puntos, { padding: [40, 40], maxZoom: 13 });
}

/** Encuadra a todos los camiones la primera vez que hay datos (cuando el mapa ya tiene tamaño). */
function Encuadrar({ puntos }: { puntos: [number, number][] }) {
  const mapa = useMap();
  const clave = puntos.length > 0;
  useEffect(() => {
    if (!clave) return;
    const t = setTimeout(() => encuadrar(mapa, puntos), 150);
    return () => clearTimeout(t);
    // Solo al pasar de "sin datos" a "con datos", para no mover el mapa en cada actualización.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapa, clave]);
  return null;
}

/** Botón «Ver todos» dentro del mapa. */
function BotonVerTodos({ puntos }: { puntos: [number, number][] }) {
  const mapa = useMap();
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (ref.current) L.DomEvent.disableClickPropagation(ref.current);
  }, []);
  if (puntos.length === 0) return null;
  return (
    <button ref={ref} type="button" className="ver-todos-mapa" onClick={() => encuadrar(mapa, puntos)}>
      Ver todos
    </button>
  );
}

function Leyenda() {
  const items = [
    { c: MARCA.verde, t: 'En ruta' },
    { c: MARCA.dorado, t: 'En frontera' },
    { c: AZUL, t: 'Cruzó la frontera' },
    { c: MORADO_DETENIDO, t: 'Detenido' },
    { c: GRIS_SIN_SENAL, t: 'Sin señal +30 min' },
    { c: CAFE_POR_INICIAR, t: 'Por iniciar' },
    { c: MARCA.rojo, t: 'Emergencia' },
  ];
  return (
    <div className="leyenda" aria-label="Leyenda del mapa">
      {items.map((i) => (
        <span key={i.t}><span className="punto" style={{ background: i.c }} />{i.t}</span>
      ))}
    </div>
  );
}

/** Distancia aproximada en metros entre dos puntos (suficiente para agrupar). */
function metros(a: [number, number], b: [number, number]) {
  const rad = Math.PI / 180;
  const x = (b[1] - a[1]) * rad * Math.cos(((a[0] + b[0]) / 2) * rad);
  const y = (b[0] - a[0]) * rad;
  return Math.sqrt(x * x + y * y) * 6_371_000;
}

// Camiones a menos de esta distancia se muestran juntos (si no, un marcador tapa al otro).
const RADIO_GRUPO_M = 500;

interface Grupo {
  centro: [number, number];
  camiones: AsignacionEnVivo[];
}

function agrupar(lista: AsignacionEnVivo[]): Grupo[] {
  const grupos: Grupo[] = [];
  for (const a of lista) {
    const p: [number, number] = [a.ultima_lat!, a.ultima_lon!];
    const g = grupos.find((x) => metros(x.centro, p) <= RADIO_GRUPO_M);
    if (g) {
      g.camiones.push(a);
      const n = g.camiones.length;
      g.centro = [(g.centro[0] * (n - 1) + p[0]) / n, (g.centro[1] * (n - 1) + p[1]) / n];
    } else {
      grupos.push({ centro: p, camiones: [a] });
    }
  }
  return grupos;
}

function DetalleCamion({ a, minDetenido }: { a: AsignacionEnVivo; minDetenido: number }) {
  return (
    <>
      <strong>{a.vehiculo?.placa}</strong> · {ETIQUETA_ETAPA[a.etapa]}
      {estaDetenido(a, Date.now(), minDetenido) && (
        <><br /><strong style={{ color: MORADO_DETENIDO }}>Detenido: sin moverse {haceCuanto(a.detenido_desde ?? null).replace('hace ', 'desde hace ')}</strong></>
      )}
      {a.emergencia_en && <><br /><strong style={{ color: MARCA.rojo }}>EMERGENCIA: {textoEmergencia(a.emergencia_motivo)}</strong></>}
      <br />
      {a.mision?.codigo} → {a.mision?.destino?.nombre}
      <br />
      {a.ultima_velocidad_kmh ?? 0} km/h · {formatoHora(a.ultima_senal)}
    </>
  );
}

export default function MapaFlota({
  asignaciones,
  seleccion,
  alSeleccionar,
  recorridos,
  minDetenido = MINUTOS_DETENIDO,
}: {
  asignaciones: AsignacionEnVivo[];
  seleccion?: string | null;
  alSeleccionar?: (id: string) => void;
  /** Una línea por camión (detalle de misión). */
  recorridos?: [number, number][][];
  /** Minutos sin moverse para marcar «Detenido». */
  minDetenido?: number;
}) {
  const conPosicion = asignaciones.filter((a) => a.ultima_lat !== null && a.ultima_lon !== null);
  const elegida = conPosicion.find((a) => a.id === seleccion);
  const punto: [number, number] | null = elegida ? [elegida.ultima_lat!, elegida.ultima_lon!] : null;
  const puntos = conPosicion.map((a) => [a.ultima_lat!, a.ultima_lon!] as [number, number]);
  const grupos = agrupar(conPosicion);

  return (
    <div style={{ position: 'relative', height: '100%', minHeight: 400 }}>
      <MapContainer center={CENTRO} zoom={6} style={{ height: '100%', width: '100%', minHeight: 400 }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {(recorridos ?? []).map((r, i) =>
          r.length > 1 ? (
            <Polyline key={i} positions={r} pathOptions={{ color: COLORES_RECORRIDO[i % COLORES_RECORRIDO.length], weight: 3, opacity: 0.85 }} />
          ) : null,
        )}
        {grupos.map((g) => {
          const ids = g.camiones.map((a) => a.id);
          const elegido = seleccion ? ids.includes(seleccion) : false;
          const enEmergencia = g.camiones.find((a) => a.emergencia_en);
          const principal = enEmergencia ?? g.camiones.find((a) => a.id === seleccion) ?? g.camiones[0]!;
          const varios = g.camiones.length > 1;
          // Con varios camiones juntos, cada clic pasa al siguiente de la lista.
          const alTocar = () => {
            if (!alSeleccionar) return;
            const i = seleccion ? ids.indexOf(seleccion) : -1;
            alSeleccionar(ids[(i + 1) % ids.length]!);
          };
          return (
            <CircleMarker
              key={ids.join('-')}
              center={g.centro}
              radius={(elegido ? 11 : 8) + (varios ? 3 : 0)}
              pathOptions={{
                color: MARCA.cafe,
                weight: elegido ? 3 : 2,
                fillColor: color(principal, minDetenido),
                fillOpacity: 0.9,
              }}
              eventHandlers={{ click: alTocar }}
            >
              <Tooltip permanent direction="right" offset={[10, 0]} className="placa-mapa">
                {g.camiones.map((a) => a.vehiculo?.placa ?? '—').join(' · ')}
                {varios && ` (${g.camiones.length} juntos)`}
              </Tooltip>
              <Popup>
                {g.camiones.map((a, i) => (
                  <div key={a.id} style={{ marginTop: i ? 8 : 0 }}>
                    <DetalleCamion a={a} minDetenido={minDetenido} />
                  </div>
                ))}
              </Popup>
            </CircleMarker>
          );
        })}
        <Encuadrar puntos={puntos} />
        <BotonVerTodos puntos={puntos} />
        <Enfocar seleccion={seleccion} lat={punto ? punto[0] : null} lon={punto ? punto[1] : null} />
      </MapContainer>
      <Leyenda />
    </div>
  );
}
