'use client';
import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { ETIQUETA_ETAPA } from '@reynales/shared';
import { crearClienteNavegador } from '@/lib/supabase/client';
import { SELECT_ASIGNACION_EN_VIVO } from '@/lib/consultas';
import { formatoHora, grupoDe, haceCuanto, prioridad, type AsignacionEnVivo, type Grupo } from '@/lib/tipos';

// Leaflet usa "window": se carga solo en el navegador.
const MapaFlota = dynamic(() => import('./MapaFlota'), { ssr: false, loading: () => <p style={{ padding: 12 }}>Cargando mapa…</p> });

const RESUMEN: { grupo: Grupo; texto: string; clase: string }[] = [
  { grupo: 'todos', texto: 'Todos', clase: '' },
  { grupo: 'en_ruta', texto: 'En ruta', clase: 'en_ruta' },
  { grupo: 'en_frontera', texto: 'En frontera', clase: 'en_frontera' },
  { grupo: 'sin_senal', texto: 'Sin señal +30 min', clase: 'sin_senal' },
  { grupo: 'programado', texto: 'Por iniciar', clase: 'programado' },
];

export default function TableroEnVivo({ iniciales }: { iniciales: AsignacionEnVivo[] }) {
  const [asignaciones, setAsignaciones] = useState(iniciales);
  const [seleccion, setSeleccion] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Grupo>('todos');
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
  const conteo = useMemo(() => {
    const c: Record<Grupo, number> = { todos: ordenadas.length, en_ruta: 0, en_frontera: 0, sin_senal: 0, programado: 0 };
    ordenadas.forEach((a) => c[grupoDe(a, ahora)]++);
    return c;
  }, [ordenadas, ahora]);
  const visibles = filtro === 'todos' ? ordenadas : ordenadas.filter((a) => grupoDe(a, ahora) === filtro);

  return (
    <>
      <div className="resumen" role="group" aria-label="Filtrar camiones">
        {RESUMEN.map((r) => (
          <button
            key={r.grupo}
            type="button"
            className={`indicador ${r.clase} ${filtro === r.grupo ? 'activo' : ''}`}
            aria-pressed={filtro === r.grupo}
            onClick={() => setFiltro(r.grupo)}
          >
            <span className="numero">{conteo[r.grupo]}</span>
            <span>{r.texto}</span>
          </button>
        ))}
      </div>
      <div className="tablero">
        <section className="tarjeta lista" style={{ padding: 0 }}>
          <h2 style={{ padding: '12px 12px 0' }}>Camiones en curso ({visibles.length})</h2>
          {ordenadas.length === 0 && (
            <div style={{ padding: 12 }}>
              <p>No hay camiones en viaje.</p>
              <Link className="boton" href="/misiones/nueva">Crear misión</Link>
            </div>
          )}
          {ordenadas.length > 0 && visibles.length === 0 && <p style={{ padding: 12 }}>Ningún camión en este grupo.</p>}
          {visibles.map((a) => {
            const grupo = grupoDe(a, ahora);
            const sinSenal = grupo === 'sin_senal';
            return (
              <div key={a.id} className={`camion ${seleccion === a.id ? 'seleccionado' : ''}`}>
              <button
                type="button"
                className="camion-principal"
                onClick={() => setSeleccion(a.id)}
                aria-pressed={seleccion === a.id}
              >
                <span className="fila">
                  <span className="placa">{a.vehiculo?.placa ?? 'Sin placa'}</span>
                  <span className={`etiqueta ${a.etapa}`}>{ETIQUETA_ETAPA[a.etapa]}</span>
                </span>
                <span className="detalle">
                  {a.mision?.codigo} · {a.mision?.cliente?.razon_social} → {a.mision?.destino?.nombre}
                </span>
                <span className="detalle">
                  {a.conductor?.nombre} · última señal:{' '}
                  <span title={formatoHora(a.ultima_senal)}>{haceCuanto(a.ultima_senal, ahora)}</span>
                  {sinSenal && a.etapa !== 'programado' && <span className="alerta"> · revisar</span>}
                </span>
              </button>
                <Link className="ver-mision" href={`/misiones/${a.mision_id}`}>
                  Ver misión →
                </Link>
              </div>
            );
          })}
        </section>
        <section className="mapa">
          <MapaFlota asignaciones={visibles} seleccion={seleccion} alSeleccionar={setSeleccion} />
        </section>
      </div>
    </>
  );
}
