'use client';
import dynamic from 'next/dynamic';
import type { CamionPublico } from './MapaSeguimientoInterno';

const Interno = dynamic(() => import('./MapaSeguimientoInterno'), { ssr: false, loading: () => <p>Cargando mapa…</p> });

export default function MapaSeguimiento(props: { camiones: CamionPublico[]; destino: { lat: number; lon: number; nombre: string } | null }) {
  return (
    <div className="mapa-seguimiento">
      <Interno {...props} />
    </div>
  );
}
