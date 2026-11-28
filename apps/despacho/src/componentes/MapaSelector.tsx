'use client';
import { useEffect } from 'react';
import { MapContainer, Circle, CircleMarker, useMap, useMapEvents } from 'react-leaflet';
import CapaBase from './CapaBase';
import { MARCA } from '@reynales/shared';

const CENTRO: [number, number] = [-17.5, -66.0];

function AlHacerClic({ alElegir }: { alElegir: (lat: number, lon: number) => void }) {
  useMapEvents({ click: (e) => alElegir(e.latlng.lat, e.latlng.lng) });
  return null;
}

/** Centra el mapa en el punto cuando se escribe a mano una coordenada válida. */
function Seguir({ punto }: { punto: [number, number] | null }) {
  const mapa = useMap();
  useEffect(() => {
    if (punto && !mapa.getBounds().contains(punto)) mapa.setView(punto, Math.max(mapa.getZoom(), 13));
  }, [punto, mapa]);
  return null;
}

export default function MapaSelector({
  punto,
  radio,
  alElegir,
}: {
  punto: [number, number] | null;
  radio: number;
  alElegir: (lat: number, lon: number) => void;
}) {
  return (
    <MapContainer center={punto ?? CENTRO} zoom={punto ? 14 : 6} style={{ height: '100%', width: '100%', cursor: 'crosshair' }}>
        <CapaBase />
      <AlHacerClic alElegir={alElegir} />
      <Seguir punto={punto} />
      {punto && (
        <>
          <Circle center={punto} radius={radio} pathOptions={{ color: MARCA.verde, fillOpacity: 0.15 }} />
          <CircleMarker center={punto} radius={6} pathOptions={{ color: MARCA.cafe, fillColor: MARCA.dorado, fillOpacity: 1 }} />
        </>
      )}
    </MapContainer>
  );
}
