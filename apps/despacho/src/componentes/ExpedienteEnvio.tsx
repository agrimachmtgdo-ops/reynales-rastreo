import { NOMBRE_MOMENTO, TIPO_DOCUMENTO, type ItemExpediente, type Momento } from '@/lib/documentos';

const ORDEN: Momento[] = ['salida_fabrica', 'salida_transbordo', 'entrega', 'embarque'];

/** Resumen corto para el encabezado de la misión: «Expediente: 7 de 9». */
export function ResumenExpediente({ items }: { items: ItemExpediente[] }) {
  const listos = items.filter((i) => i.tiene).length;
  const completo = listos === items.length;
  return (
    <p className={`indicador-docs ${completo ? 'completo' : 'incompleto'}`}>
      <strong>Expediente:</strong> {listos} de {items.length} {completo ? '✓' : `· faltan ${items.length - listos}`}
    </p>
  );
}

/**
 * «Expediente del envío: 7 de 9»: documentos que exigen el destino y el cliente, por momento
 * (salida de fábrica, transbordo, entrega, embarque) y por camión cuando corresponde.
 */
export default function ExpedienteEnvio({ items }: { items: ItemExpediente[] }) {
  if (items.length === 0) return <p className="nota-estimado">Este envío no tiene documentos exigidos.</p>;
  const listos = items.filter((i) => i.tiene).length;
  return (
    <div className="expediente">
      <h3>Expediente del envío: {listos} de {items.length}</h3>
      {ORDEN.filter((m) => items.some((i) => i.momento === m)).map((m) => (
        <div key={m} className="grupo-expediente">
          <h4>{NOMBRE_MOMENTO[m]}</h4>
          <ul>
            {items.filter((i) => i.momento === m).map((i) => (
              <li key={`${i.documento}-${i.asignacion_id ?? 'mision'}`} className={i.tiene ? 'tiene' : 'falta'}>
                <span aria-hidden="true">{i.tiene ? '✓' : '✗'}</span>{' '}
                {TIPO_DOCUMENTO[i.documento] ?? i.documento}
                {i.placa && <> · camión {i.placa}</>}
                <span className="solo-lector">{i.tiene ? ' (está)' : ' (falta)'}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p className="ayuda">Lo que se exige depende del destino y del cliente (Catálogos → Clientes → Editar).</p>
    </div>
  );
}
