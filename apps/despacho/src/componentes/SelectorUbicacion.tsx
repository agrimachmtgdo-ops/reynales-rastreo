'use client';
import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';

const MapaSelector = dynamic(() => import('./MapaSelector'), { ssr: false, loading: () => <p style={{ padding: 12 }}>Cargando mapa…</p> });

const aNumero = (v: string) => {
  const n = Number(v.replace(',', '.'));
  return v.trim() !== '' && Number.isFinite(n) ? n : null;
};

/**
 * Campos de latitud, longitud y radio, con un mapa: un clic en el mapa llena las coordenadas
 * y el círculo muestra la geocerca. Ocupa todo el ancho de la rejilla del formulario.
 */
export default function SelectorUbicacion({
  lat: latInicial = '',
  lon: lonInicial = '',
  radio: radioInicial = '500',
}: {
  lat?: string;
  lon?: string;
  radio?: string;
}) {
  const [lat, setLat] = useState(latInicial);
  const [lon, setLon] = useState(lonInicial);
  const [radio, setRadio] = useState(radioInicial);
  const ref = useRef<HTMLInputElement>(null);

  // Si el formulario se limpia después de guardar, volver a los valores iniciales.
  useEffect(() => {
    const formulario = ref.current?.form;
    if (!formulario) return;
    const limpiar = () => { setLat(latInicial); setLon(lonInicial); setRadio(radioInicial); };
    formulario.addEventListener('reset', limpiar);
    return () => formulario.removeEventListener('reset', limpiar);
  }, [latInicial, lonInicial, radioInicial]);

  const la = aNumero(lat);
  const lo = aNumero(lon);
  const punto: [number, number] | null = la !== null && lo !== null && Math.abs(la) <= 90 && Math.abs(lo) <= 180 ? [la, lo] : null;

  return (
    <div style={{ gridColumn: '1 / -1' }}>
      <div className="rejilla">
        <label>Latitud <span className="obligatorio">*</span>
          <input ref={ref} name="lat" required inputMode="decimal" placeholder="-19.8050" value={lat} onChange={(e) => setLat(e.target.value)} />
        </label>
        <label>Longitud <span className="obligatorio">*</span>
          <input name="lon" required inputMode="decimal" placeholder="-63.9560" value={lon} onChange={(e) => setLon(e.target.value)} />
        </label>
        <label>Radio de geocerca (m)
          <input name="radio_m" inputMode="numeric" value={radio} onChange={(e) => setRadio(e.target.value)} />
        </label>
      </div>
      <p className="ayuda">Haga clic en el mapa sobre el lugar exacto para llenar latitud y longitud. El círculo verde es la geocerca.</p>
      <div style={{ height: 320, borderRadius: 10, overflow: 'hidden', border: '1px solid var(--borde)', marginBottom: 12 }}>
        <MapaSelector
          punto={punto}
          radio={aNumero(radio) ?? 500}
          alElegir={(a, b) => { setLat(a.toFixed(6)); setLon(b.toFixed(6)); }}
        />
      </div>
    </div>
  );
}
