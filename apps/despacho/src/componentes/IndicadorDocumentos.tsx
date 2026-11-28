import { estadoDocumentos } from '@/lib/documentos';

/** «Documentos: Factura ✓ · DEX ✗ · Lista de empaque (opcional) ✗», con texto y no solo color. */
export default function IndicadorDocumentos({ claves, pais }: { claves: string[]; pais: string | null | undefined }) {
  const estado = estadoDocumentos(claves, pais);
  const faltan = estado.filter((e) => e.obligatorio && !e.tiene);
  return (
    <p className={`indicador-docs ${faltan.length ? 'incompleto' : 'completo'}`}>
      <strong>Documentos:</strong>{' '}
      {estado.map((e, i) => (
        <span key={e.clave}>
          {i > 0 && ' · '}
          {e.nombre}{e.obligatorio ? '' : ' (opcional)'} {e.tiene ? '✓' : '✗'}
        </span>
      ))}
      {faltan.length > 0 && <span className="sr-only"> Faltan: {faltan.map((e) => e.nombre).join(' y ')}.</span>}
    </p>
  );
}
