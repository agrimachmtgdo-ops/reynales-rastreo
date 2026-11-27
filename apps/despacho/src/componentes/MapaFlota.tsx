'use client';
import { useEffect } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, Polyline, useMap } from 'react-leaflet';
import { ETIQUETA_ETAPA, MARCA } from '@reynales/shared';
import { formatoHora, type AsignacionEnVivo } from '@/lib/tipos';

// Centro inicial: entre Monteagudo y Desaguadero.
const CENTRO: [number, number] = [-17.6, -66.5];

function color(etapa: AsignacionEnVivo['etapa']) {
  if (etapa === 'en_frontera') return MARCA.dorado;
  if (etapa === 'cruzo_frontera') return '#1d4f80';
  return MARCA.verde;
}

function Enfocar({ punto }: { punto: [number, number] | null }) {
  const mapa = useMap();
  useEffect(() => {
    if (punto) mapa.flyTo(punto, 11, { duration: 0.8 });
  }, [mapa, punto]);
  return null;
}

export default function MapaFlota({
  asignaciones,
  seleccion,
  recorrido,
}: {
  asignaciones: AsignacionEnVivo[];
  seleccion?: string | null;
  recorrido?: [number, number][];
}) {
  const conPosicion = asignaciones.filter((a) => a.ultima_lat !== null && a.ultima_lon !== null);
  const elegida = conPosicion.find((a) => a.id === seleccion);
  const punto: [number, number] | null = elegida ? [elegida.ultima_lat!, elegida.ultima_lon!] : null;

  return (
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
          pathOptions={{ color: MARCA.cafe, weight: 2, fillColor: color(a.etapa), fillOpacity: 0.9 }}
        >
          <Popup>
            <strong>{a.vehiculo?.placa}</strong> · {ETIQUETA_ETAPA[a.etapa]}
            <br />
            {a.mision?.codigo} → {a.mision?.destino?.nombre}
            <br />
            {a.ultima_velocidad_kmh ?? 0} km/h · {formatoHora(a.ultima_senal)}
          </Popup>
        </CircleMarker>
      ))}
      <Enfocar punto={punto} />
    </MapContainer>
  );
}
