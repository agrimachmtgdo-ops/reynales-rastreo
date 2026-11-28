import { ETAPAS, ETIQUETA_ETAPA, type Etapa } from '@reynales/shared';
import { formatoHora } from '@/lib/tipos';

/** Pasos del viaje; los de frontera solo si el destino es Perú. */
function pasos(destinoPais: string | null | undefined): Etapa[] {
  return destinoPais === 'PE'
    ? ['programado', 'cargado', 'en_ruta', 'en_frontera', 'cruzo_frontera', 'entregado']
    : ['programado', 'cargado', 'en_ruta', 'entregado'];
}

/**
 * Barra de avance por etapas, con la hora en que se alcanzó cada una.
 * Accesible: es una lista ordenada y la etapa actual lleva aria-current.
 */
export default function BarraEtapas({
  etapa,
  destinoPais,
  horas,
  zona,
}: {
  etapa: Etapa;
  destinoPais: string | null | undefined;
  /** Primera vez que se alcanzó cada etapa. */
  horas: Partial<Record<Etapa, string>>;
  /** Zona horaria para mostrar las horas (por defecto, Bolivia). */
  zona?: string;
}) {
  if (etapa === 'cancelado') return <p className="alerta">Misión cancelada.</p>;
  const lista = pasos(destinoPais);
  // Si la etapa actual no está en la lista (p. ej. frontera en un viaje nacional), se usa la más cercana anterior.
  const orden = (e: Etapa) => ETAPAS.indexOf(e);
  const actual = Math.max(0, lista.includes(etapa)
    ? lista.indexOf(etapa)
    : lista.filter((p) => orden(p) < orden(etapa)).length - 1);
  return (
    <ol className="barra-etapas" aria-label="Avance del viaje">
      {lista.map((p, i) => {
        const estado = i < actual ? 'hecha' : i === actual ? 'actual' : 'pendiente';
        return (
          <li key={p} className={estado} aria-current={estado === 'actual' ? 'step' : undefined}>
            <span className="marca" aria-hidden="true">{estado === 'hecha' ? '✓' : i + 1}</span>
            <span className="nombre">{ETIQUETA_ETAPA[p]}</span>
            {horas[p] && <span className="hora">{formatoHora(horas[p]!, zona)}</span>}
            <span className="visualmente-oculto">{estado === 'hecha' ? ' (completada)' : estado === 'actual' ? ' (etapa actual)' : ' (pendiente)'}</span>
          </li>
        );
      })}
    </ol>
  );
}
