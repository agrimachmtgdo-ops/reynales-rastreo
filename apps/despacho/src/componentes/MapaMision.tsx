'use client';
import dynamic from 'next/dynamic';
import type { AsignacionEnVivo } from '@/lib/tipos';

const MapaFlota = dynamic(() => import('./MapaFlota'), { ssr: false, loading: () => <p>Cargando mapa…</p> });

export default function MapaMision(props: { asignaciones: AsignacionEnVivo[]; recorridos: [number, number][][] }) {
  return (
    <div className="mapa-mision" style={{ height: 380, borderRadius: 10, overflow: 'hidden', border: '1px solid var(--borde)' }}>
      <MapaFlota asignaciones={props.asignaciones} recorridos={props.recorridos} />
    </div>
  );
}
