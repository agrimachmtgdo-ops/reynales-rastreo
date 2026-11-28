'use client';
import { useEffect } from 'react';
import { MapContainer, TileLayer, Circle, CircleMarker, Tooltip, useMap } from 'react-leaflet';
import { ETIQUETA_ETAPA, MARCA, type Etapa } from '@reynales/shared';

export interface CamionPublico {
  nombre: string;
  etapa: Etapa;
  parado: boolean;
  lat: number | null;
  lon: number | null;
}

function Encuadrar({ puntos }: { puntos: [number, number][] }) {
  const mapa = useMap();
  useEffect(() => {
    const t = setTimeout(() => {
      mapa.invalidateSize();
      if (puntos.length === 1) mapa.setView(puntos[0]!, 8);
      else if (puntos.length > 1) mapa.fitBounds(puntos, { padding: [40, 40], maxZoom: 10 });
    }, 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapa, puntos.length]);
  return null;
}

/** Radio de la zona que se dibuja para un camión detenido (su posición llega redondeada a ~11 km). */
const RADIO_ZONA_M = 10_000;

/** Mapa del cliente: cada camión (posición aproximada y con retraso) y el destino. Sin recorrido. */
export default function MapaSeguimientoInterno({
  camiones,
  destino,
}: {
  camiones: CamionPublico[];
  destino: { lat: number; lon: number; nombre: string } | null;
}) {
  const conPosicion = camiones.filter((c) => c.lat !== null && c.lon !== null);
  const puntos: [number, number][] = conPosicion.map((c) => [c.lat!, c.lon!]);
  if (destino) puntos.push([destino.lat, destino.lon]);

  return (
    <MapContainer center={puntos[0] ?? [-17.6, -66.5]} zoom={6} maxZoom={11} style={{ height: '100%', width: '100%' }} scrollWheelZoom={false}>
      <TileLayer
        attribution={'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        referrerPolicy="strict-origin-when-cross-origin"
      />
      <Encuadrar puntos={puntos} />
      {destino && (
        <CircleMarker center={[destino.lat, destino.lon]} radius={9} pathOptions={{ color: MARCA.cafe, fillColor: MARCA.blanco, fillOpacity: 1, weight: 3 }}>
          <Tooltip permanent direction="top" offset={[0, -8]} className="placa-mapa">Destino: {destino.nombre}</Tooltip>
        </CircleMarker>
      )}
      {conPosicion.map((c, i) => c.parado ? (
        <Circle key={`${c.nombre}-${i}`} center={[c.lat!, c.lon!]} radius={RADIO_ZONA_M}
          pathOptions={{ color: MARCA.cafe, fillColor: MARCA.dorado, fillOpacity: 0.3, weight: 2, dashArray: '6 6' }}>
          <Tooltip permanent direction="top" className="placa-mapa">{c.nombre} · Detenido (zona aproximada)</Tooltip>
        </Circle>
      ) : (
        <CircleMarker key={`${c.nombre}-${i}`} center={[c.lat!, c.lon!]} radius={10}
          pathOptions={{ color: MARCA.cafe, fillColor: c.etapa === 'en_frontera' ? MARCA.dorado : MARCA.verde, fillOpacity: 0.9, weight: 2 }}>
          <Tooltip permanent direction="top" offset={[0, -8]} className="placa-mapa">{c.nombre} · {ETIQUETA_ETAPA[c.etapa]}</Tooltip>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}
