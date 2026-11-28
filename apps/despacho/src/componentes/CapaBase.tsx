'use client';
import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { TileLayer } from 'react-leaflet';

/**
 * Capa base de todos los mapas del panel.
 *  - «Carreteras»: CARTO Voyager, con las rutas principales bien marcadas desde la vista de país.
 *    Necesita la clave gratuita NEXT_PUBLIC_CARTO_KEY (si falta, se usa el mapa clásico).
 *  - «Clásico»: OpenStreetMap estándar (el mapa de siempre).
 * La elección se recuerda en este navegador.
 */
const CLAVE_CARTO = process.env.NEXT_PUBLIC_CARTO_KEY ?? '';
export const HAY_CARRETERAS = CLAVE_CARTO !== '';

type Estilo = 'carreteras' | 'clasico';
const GUARDADO = 'reynales.mapa.estilo';

const CAPAS: Record<Estilo, { url: string; atribucion: string; subdominios: string }> = {
  carreteras: {
    url: `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(CLAVE_CARTO)}`,
    atribucion: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdominios: 'abcd',
  },
  clasico: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    atribucion: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    subdominios: 'abc',
  },
};

function leerGuardado(): Estilo | null {
  try {
    const v = window.localStorage.getItem(GUARDADO);
    return v === 'carreteras' || v === 'clasico' ? v : null;
  } catch {
    return null;
  }
}

export default function CapaBase({ selector = true }: { selector?: boolean }) {
  const [estilo, setEstilo] = useState<Estilo>(HAY_CARRETERAS ? 'carreteras' : 'clasico');
  const caja = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const g = leerGuardado();
    if (g && (g === 'clasico' || HAY_CARRETERAS)) setEstilo(g);
  }, []);
  useEffect(() => {
    if (caja.current) {
      L.DomEvent.disableClickPropagation(caja.current);
      L.DomEvent.disableScrollPropagation(caja.current);
    }
  }, []);

  function elegir(e: Estilo) {
    setEstilo(e);
    try { window.localStorage.setItem(GUARDADO, e); } catch { /* sin almacenamiento: solo esta vez */ }
  }

  const capa = CAPAS[estilo];
  return (
    <>
      <TileLayer key={estilo} url={capa.url} attribution={capa.atribucion} subdomains={capa.subdominios} referrerPolicy="strict-origin-when-cross-origin" />
      {selector && HAY_CARRETERAS && (
        <div ref={caja} className="selector-capa" role="group" aria-label="Tipo de mapa">
          {(['carreteras', 'clasico'] as const).map((e) => (
            <button key={e} type="button" aria-pressed={estilo === e} className={estilo === e ? 'activo' : undefined} onClick={() => elegir(e)}>
              {e === 'carreteras' ? 'Carreteras' : 'Clásico'}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
