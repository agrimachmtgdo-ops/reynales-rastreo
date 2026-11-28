'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { ETIQUETA_ETAPA } from '@reynales/shared';
import { crearClienteNavegador } from '@/lib/supabase/client';
import { SELECT_ASIGNACION_EN_VIVO } from '@/lib/consultas';
import {
  enlaceWhatsApp, formatoHora, grupoDe, haceCuanto, minutosDetenido, MINUTOS_DETENIDO, prioridad, textoEmergencia,
  type AsignacionEnVivo, type Grupo,
} from '@/lib/tipos';

// Leaflet usa "window": se carga solo en el navegador.
const MapaFlota = dynamic(() => import('./MapaFlota'), { ssr: false, loading: () => <p style={{ padding: 12 }}>Cargando mapa…</p> });

const resumen = (minDetenido: number): { grupo: Grupo; texto: string; clase: string }[] => [
  { grupo: 'todos', texto: 'Todos', clase: '' },
  { grupo: 'en_ruta', texto: 'En ruta', clase: 'en_ruta' },
  { grupo: 'en_frontera', texto: 'En frontera', clase: 'en_frontera' },
  { grupo: 'detenido', texto: `Detenido +${minDetenido} min`, clase: 'detenido' },
  { grupo: 'sin_senal', texto: 'Sin señal +30 min', clase: 'sin_senal' },
  { grupo: 'programado', texto: 'Por iniciar', clase: 'programado' },
];

const CLAVE_AVISOS = 'tablero-avisos-sin-senal';

/** Pitido corto (sin archivos de audio) para avisar que un camión perdió la señal. */
function pitar() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const vol = ctx.createGain();
    osc.frequency.value = 880;
    vol.gain.setValueAtTime(0.15, ctx.currentTime);
    vol.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    osc.connect(vol).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.6);
  } catch {
    /* sin audio disponible */
  }
}

type EstadoConexion = 'conectando' | 'conectado' | 'reconectando';

export default function TableroEnVivo({
  iniciales,
  minDetenido = MINUTOS_DETENIDO,
}: {
  iniciales: AsignacionEnVivo[];
  /** Minutos sin moverse para marcar «Detenido» (configurable). */
  minDetenido?: number;
}) {
  const [asignaciones, setAsignaciones] = useState(iniciales);
  const [seleccion, setSeleccion] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Grupo>('todos');
  const [ahora, setAhora] = useState(() => Date.now());
  const [conexion, setConexion] = useState<EstadoConexion>('conectando');
  const [avisos, setAvisos] = useState(false);
  const yaAvisados = useRef<Set<string>>(new Set());
  const emergenciasVistas = useRef<Set<string> | null>(null);

  // Preferencia de avisos (se recuerda en este navegador).
  useEffect(() => {
    try {
      setAvisos(localStorage.getItem(CLAVE_AVISOS) === '1');
    } catch {
      /* sin almacenamiento */
    }
  }, []);

  async function alternarAvisos() {
    const nuevo = !avisos;
    if (nuevo && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      await Notification.requestPermission().catch(() => undefined);
    }
    if (nuevo) pitar(); // prueba de sonido
    setAvisos(nuevo);
    try {
      localStorage.setItem(CLAVE_AVISOS, nuevo ? '1' : '0');
    } catch {
      /* sin almacenamiento */
    }
  }

  // Recarga completa (al reconectar o al volver a la pestaña), para no quedar con datos viejos.
  const recargar = useCallback(async () => {
    const supabase = crearClienteNavegador();
    const { data } = await supabase
      .from('asignaciones')
      .select(SELECT_ASIGNACION_EN_VIVO)
      .not('etapa', 'in', '(entregado,cancelado)')
      .order('ultima_senal', { ascending: false, nullsFirst: false });
    if (data) setAsignaciones(data as unknown as AsignacionEnVivo[]);
    setAhora(Date.now());
  }, []);

  // Tiempo real: las posiciones se aplican directo desde el evento; si cambia la etapa o aparece
  // un camión nuevo, se consulta la fila completa.
  useEffect(() => {
    const supabase = crearClienteNavegador();
    let primeraVez = true;
    const canal = supabase
      .channel('tablero-asignaciones')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'asignaciones' }, async (cambio) => {
        const nueva = cambio.new as Partial<AsignacionEnVivo> & { id?: string };
        const id = nueva?.id ?? (cambio.old as { id?: string })?.id;
        if (!id) return;
        let aplicado = false;
        setAsignaciones((previas) => {
          const actual = previas.find((a) => a.id === id);
          if (!actual || !nueva.etapa || nueva.etapa !== actual.etapa) return previas;
          // Una emergencia nueva o atendida se consulta completa.
          if ((nueva.emergencia_en ?? null) !== (actual.emergencia_en ?? null)) return previas;
          aplicado = true;
          // Se descarta un evento más viejo que lo ya mostrado.
          if (actual.ultima_senal && nueva.ultima_senal && nueva.ultima_senal < actual.ultima_senal) return previas;
          return previas.map((a) =>
            a.id === id
              ? {
                  ...a,
                  ultima_lat: nueva.ultima_lat ?? a.ultima_lat,
                  ultima_lon: nueva.ultima_lon ?? a.ultima_lon,
                  ultima_velocidad_kmh: nueva.ultima_velocidad_kmh ?? a.ultima_velocidad_kmh,
                  ultima_senal: nueva.ultima_senal ?? a.ultima_senal,
                  detenido_desde: nueva.detenido_desde !== undefined ? nueva.detenido_desde : a.detenido_desde,
                }
              : a,
          );
        });
        if (aplicado) return;
        const { data } = await supabase.from('asignaciones').select(SELECT_ASIGNACION_EN_VIVO).eq('id', id).maybeSingle();
        setAsignaciones((previas) => {
          const resto = previas.filter((a) => a.id !== id);
          const fila = data as unknown as AsignacionEnVivo | null;
          if (!fila || fila.etapa === 'entregado' || fila.etapa === 'cancelado') return resto;
          return [fila, ...resto];
        });
      })
      .subscribe((estado) => {
        if (estado === 'SUBSCRIBED') {
          setConexion('conectado');
          if (!primeraVez) void recargar();
          primeraVez = false;
        } else if (estado === 'CHANNEL_ERROR' || estado === 'TIMED_OUT' || estado === 'CLOSED') {
          setConexion('reconectando');
        }
      });
    const reloj = setInterval(() => setAhora(Date.now()), 60_000);
    const alVolver = () => {
      if (document.visibilityState === 'visible') void recargar();
    };
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      clearInterval(reloj);
      document.removeEventListener('visibilitychange', alVolver);
      supabase.removeChannel(canal);
    };
  }, [recargar]);

  // Aviso cuando un camión en viaje pasa a "sin señal +30 min" (una vez por camión hasta que vuelva la señal).
  useEffect(() => {
    const sinSenal = asignaciones.filter((a) => a.etapa !== 'programado' && grupoDe(a, ahora, minDetenido) === 'sin_senal');
    const ids = new Set(sinSenal.map((a) => a.id));
    for (const id of [...yaAvisados.current]) if (!ids.has(id)) yaAvisados.current.delete(id);
    const nuevos = sinSenal.filter((a) => !yaAvisados.current.has(a.id));
    nuevos.forEach((a) => yaAvisados.current.add(a.id));
    if (!avisos || nuevos.length === 0) return;
    pitar();
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      const placas = nuevos.map((a) => a.vehiculo?.placa ?? 'sin placa').join(', ');
      new Notification('Camión sin señal', { body: `${placas}: más de 30 min sin enviar ubicación.` });
    }
  }, [asignaciones, ahora, avisos, minDetenido]);

  // Emergencias: pitido triple y notificación SIEMPRE (no depende del botón de avisos).
  // Las que ya estaban al abrir la página no suenan; se ven en la franja roja.
  useEffect(() => {
    const activas = asignaciones.filter((a) => a.emergencia_en);
    const claves = new Set(activas.map((a) => `${a.id}:${a.emergencia_en}`));
    if (emergenciasVistas.current === null) {
      emergenciasVistas.current = claves;
      return;
    }
    const nuevas = activas.filter((a) => !emergenciasVistas.current!.has(`${a.id}:${a.emergencia_en}`));
    emergenciasVistas.current = claves;
    if (nuevas.length === 0) return;
    pitar();
    setTimeout(pitar, 700);
    setTimeout(pitar, 1400);
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      for (const a of nuevas) {
        new Notification(`EMERGENCIA · ${a.vehiculo?.placa ?? ''}`, {
          body: `${textoEmergencia(a.emergencia_motivo)} · ${a.conductor?.nombre ?? ''}`,
          requireInteraction: true,
        });
      }
    }
  }, [asignaciones]);

  const emergencias = asignaciones.filter((a) => a.emergencia_en);

  const ordenadas = useMemo(
    () => [...asignaciones].sort((a, b) => prioridad(a, ahora, minDetenido) - prioridad(b, ahora, minDetenido)),
    [asignaciones, ahora, minDetenido],
  );
  const conteo = useMemo(() => {
    const c: Record<Grupo, number> = { todos: ordenadas.length, en_ruta: 0, en_frontera: 0, detenido: 0, sin_senal: 0, programado: 0 };
    ordenadas.forEach((a) => c[grupoDe(a, ahora, minDetenido)]++);
    return c;
  }, [ordenadas, ahora, minDetenido]);
  const visibles = filtro === 'todos' ? ordenadas : ordenadas.filter((a) => grupoDe(a, ahora, minDetenido) === filtro);

  return (
    <>
      <div className="barra-tablero">
        <span className={`conexion ${conexion}`} role="status">
          {conexion === 'conectado' ? '● En vivo' : conexion === 'reconectando' ? '● Reconectando… los datos pueden estar atrasados' : '● Conectando…'}
        </span>
        <button type="button" className="enlace-boton" onClick={() => void alternarAvisos()} aria-pressed={avisos}>
          {avisos ? '🔔 Avisos de sin señal: activados' : '🔕 Activar avisos de sin señal'}
        </button>
      </div>
      {emergencias.length > 0 && (
        <div className="franja-emergencia" role="alert">
          {emergencias.map((a) => (
            <div key={a.id}>
              <strong>EMERGENCIA · {a.vehiculo?.placa}</strong> · {textoEmergencia(a.emergencia_motivo)} · {a.conductor?.nombre} ·{' '}
              <span title={formatoHora(a.emergencia_en)}>{haceCuanto(a.emergencia_en, ahora)}</span> ·{' '}
              <Link href={`/misiones/${a.mision_id}`}>Atender →</Link>
              {a.conductor?.telefono && <> · <a href={`tel:${a.conductor.telefono.replace(/[^0-9+]/g, '')}`}>Llamar</a></>}
            </div>
          ))}
        </div>
      )}
      <div className="resumen" role="group" aria-label="Filtrar camiones">
        {resumen(minDetenido).map((r) => (
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
            const grupo = grupoDe(a, ahora, minDetenido);
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
                {grupo === 'detenido' && (
                  <span className="etiqueta detenido">Detenido hace {haceCuanto(a.detenido_desde ?? null, ahora).replace('hace ', '')} ({minutosDetenido(a, ahora)} min)</span>
                )}
                {a.emergencia_en && <span className="etiqueta emergencia">EMERGENCIA: {textoEmergencia(a.emergencia_motivo)}</span>}
              </button>
                <span className="acciones-camion">
                  <Link className="ver-mision" href={`/misiones/${a.mision_id}`}>
                    Ver misión →
                  </Link>
                  {!enlaceWhatsApp(a.conductor?.telefono) && (
                    <Link
                      className="ver-mision aviso-sin-whatsapp"
                      href={a.conductor?.id ? `/catalogos?pestana=conductores&editar=${a.conductor.id}` : '/catalogos?pestana=conductores'}
                      title={a.conductor?.telefono ? `Número guardado sin código de país: ${a.conductor.telefono}` : 'El chofer no tiene teléfono registrado'}
                    >
                      Sin WhatsApp registrado · editar chofer
                    </Link>
                  )}
                  {enlaceWhatsApp(a.conductor?.telefono) && (
                    <a
                      className="ver-mision"
                      href={enlaceWhatsApp(a.conductor?.telefono, `Hola ${a.conductor?.nombre ?? ''}, le escribimos de despacho de Industrias Reynales sobre el camión ${a.vehiculo?.placa ?? ''}.`)!}
                      target="_blank"
                      rel="noreferrer"
                    >
                      WhatsApp al chofer
                    </a>
                  )}
                </span>
              </div>
            );
          })}
        </section>
        <section className="mapa">
          <MapaFlota asignaciones={visibles} seleccion={seleccion} alSeleccionar={setSeleccion} minDetenido={minDetenido} />
        </section>
      </div>
    </>
  );
}
