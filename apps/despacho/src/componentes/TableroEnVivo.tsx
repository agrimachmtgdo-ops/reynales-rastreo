'use client';
import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { ETIQUETA_ETAPA } from '@reynales/shared';
import { crearClienteNavegador } from '@/lib/supabase/client';
import { SELECT_ASIGNACION_EN_VIVO } from '@/lib/consultas';
import { formatoHora, minutosSinSenal, prioridad, type AsignacionEnVivo } from '@/lib/tipos';

// Leaflet usa "window": se carga solo en el navegador.
const MapaFlota = dynamic(() => import('./MapaFlota'), { ssr: false, loading: () => <p>Cargando mapa…</p> });

export default function TableroEnVivo({ iniciales }: { iniciales: AsignacionEnVivo[] }) {
  const [asignaciones, setAsignaciones] = useState(iniciales);
  const [seleccion, setSeleccion] = useState<string | null>(null);
  const [ahora, setAhora] = useState(() => Date.now());

  // Tiempo real: cada vez que un camión envía posiciones o cambia de etapa, se actualiza la fila.
  useEffect(() => {
    const supabase = crearClienteNavegador();
    const canal = supabase
      .channel('tablero-asignaciones')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'asignaciones' }, async (cambio) => {
        const id = (cambio.new as { id?: string })?.id ?? (cambio.old as { id?: string })?.id;
        if (!id) return;
        const { data } = await supabase.from('asignaciones').select(SELECT_ASIGNACION_EN_VIVO).eq('id', id).maybeSingle();
        setAsignaciones((previas) => {
          const resto = previas.filter((a) => a.id !== id);
          const fila = data as unknown as AsignacionEnVivo | null;
          if (!fila || fila.etapa === 'entregado' || fila.etapa === 'cancelado') return resto;
          return [fila, ...resto];
        });
      })
      .subscribe();
    const reloj = setInterval(() => setAhora(Date.now()), 60_000);
    return () => {
      clearInterval(reloj);
      supabase.removeChannel(canal);
    };
  }, []);

  const ordenadas = useMemo(
    () => [...asignaciones].sort((a, b) => prioridad(a, ahora) - prioridad(b, ahora)),
    [asignaciones, ahora],
  );

  return (
    <div className="tablero">
      <section className="tarjeta lista" style={{ padding: 0 }}>
        <h2 style={{ padding: '12px 12px 0' }}>Camiones en curso ({ordenadas.length})</h2>
        {ordenadas.length === 0 && <p style={{ padding: 12 }}>No hay camiones en viaje.</p>}
        {ordenadas.map((a) => {
          const min = minutosSinSenal(a.ultima_senal, ahora);
          const sinSenal = a.etapa !== 'programado' && (min === null || min > 30);
          return (
            <div
              key={a.id}
              className="camion"
              onClick={() => setSeleccion(a.id)}
              style={seleccion === a.id ? { background: 'var(--crema)' } : undefined}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="placa">{a.vehiculo?.placa ?? 'Sin placa'}</span>
                <span className={`etiqueta ${a.etapa}`}>{ETIQUETA_ETAPA[a.etapa]}</span>
              </div>
              <div className="detalle">
                <Link href={`/misiones/${a.mision_id}`}>{a.mision?.codigo}</Link> · {a.mision?.cliente?.razon_social} →{' '}
                {a.mision?.destino?.nombre}
              </div>
              <div className="detalle">
                {a.conductor?.nombre} · última señal: {formatoHora(a.ultima_senal)}
                {sinSenal && <span className="alerta"> · {min === null ? 'nunca envió' : `sin señal hace ${min} min`}</span>}
              </div>
            </div>
          );
        })}
      </section>
      <section className="mapa">
        <MapaFlota asignaciones={ordenadas} seleccion={seleccion} />
      </section>
    </div>
  );
}
