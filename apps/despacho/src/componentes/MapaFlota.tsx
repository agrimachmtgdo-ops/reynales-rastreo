'use client';
import { useEffect } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, Polyline, Tooltip, useMap } from 'react-leaflet';
import { ETIQUETA_ETAPA, MARCA } from '@reynales/shared';
import { formatoHora, type AsignacionEnVivo } from '@/lib/tipos';

// Centro inicial: entre Monteagudo y Desaguadero.
const CENTRO: [number, number] = [-17.6, -66.5];
const AZUL = '#1d4f80';

function color(etapa: AsignacionEnVivo['etapa']) {
  if (etapa === 'en_frontera') return MARCA.dorado;
  if (etapa === 'cruzo_frontera') return AZUL;
  return MARCA.verde;
}

function Enfocar({ punto }: { punto: [number, number] | null }) {
  const mapa = useMap();
  useEffect(() => {
    if (punto) mapa.flyTo(punto, 11, { duration: 0.8 });
  }, [mapa, punto]);
  return null;
}

/** Encuadra a todos los camiones con posición la primera vez que hay datos. */
function Encuadrar({ puntos }: { puntos: [number, number][] }) {
  const mapa = useMap();
  const clave = puntos.length > 0;
  useEffect(() => {
    if (puntos.length === 1) mapa.setView(puntos[0]!, 10);
    else if (puntos.length > 1) mapa.fitBounds(puntos, { padding: [40, 40], maxZoom: 11 });
    // Solo al pasar de "sin datos" a "con datos", para no mover el mapa en cada actualización.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapa, clave]);
  return null;
}

function Leyenda() {
  const items = [
    { c: MARCA.verde, t: 'En ruta' },
    { c: MARCA.dorado, t: 'En frontera' },
    { c: AZUL, t: 'Cruzó a Perú' },
  ];
  return (
    <div className="leyenda" aria-label="Leyenda del mapa">
      {items.map((i) => (
        <span key={i.t}><span className="punto" style={{ background: i.c }} />{i.t}</span>
      ))}
    </div>
  );
}

export default function MapaFlota({
  asignaciones,
  seleccion,
  alSeleccionar,
  recorrido,
}: {
  asignaciones: AsignacionEnVivo[];
  seleccion?: string | null;
  alSeleccionar?: (id: string) => void;
  recorrido?: [number, number][];
}) {
  const conPosicion = asignaciones.filter((a) => a.ultima_lat !== null && a.ultima_lon !== null);
  const elegida = conPosicion.find((a) => a.id === seleccion);
  const punto: [number, number] | null = elegida ? [elegida.ultima_lat!, elegida.ultima_lon!] : null;
  const puntos = conPosicion.map((a) => [a.ultima_lat!, a.ultima_lon!] as [number, number]);

  return (
    <div style={{ position: 'relative', height: '100%', minHeight: 400 }}>
      <MapContainer center={CENTRO} zoom={6} style={{ height: '100%', width: '100%', minHeight: 400 }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {recorrido && recorrido.length > 1 && <Polyline positions={recorrido} pathOptions={{ color: MARCA.cafe, weight: 3 }} />}
        {conPosicion.map((a) => (
          <CircleMarker
            key={a.id}
            center={[a.ultima_lat!, a.ultima_lon!]}
            radius={a.id === seleccion ? 11 : 8}
            pathOptions={{ color: MARCA.cafe, weight: a.id === seleccion ? 3 : 2, fillColor: color(a.etapa), fillOpacity: 0.9 }}
            eventHandlers={{ click: () => alSeleccionar?.(a.id) }}
          >
            <Tooltip permanent direction="right" offset={[10, 0]} className="placa-mapa">
              {a.vehiculo?.placa ?? '—'}
            </Tooltip>
            <Popup>
              <strong>{a.vehiculo?.placa}</strong> · {ETIQUETA_ETAPA[a.etapa]}
              <br />
              {a.mision?.codigo} → {a.mision?.destino?.nombre}
              <br />
              {a.ultima_velocidad_kmh ?? 0} km/h · {formatoHora(a.ultima_senal)}
            </Popup>
          </CircleMarker>
        ))}
        <Encuadrar puntos={puntos} />
        <Enfocar punto={punto} />
      </MapContainer>
      <Leyenda />
    </div>
  );
}
