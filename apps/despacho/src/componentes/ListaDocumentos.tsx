import { formatoHora } from '@/lib/tipos';
import { TIPO_DOCUMENTO, type DocumentoVigente } from '@/lib/documentos';

/** Documentos vigentes con enlace temporal (10 min) para verlos. */
export default function ListaDocumentos({ documentos, enlaces }: { documentos: DocumentoVigente[]; enlaces: Record<string, string> }) {
  if (documentos.length === 0) return <p>Todavía no hay documentos.</p>;
  return (
    <ul className="lista-documentos">
      {documentos.map((d) => (
        <li key={d.id}>
          <div>
            <strong>{TIPO_DOCUMENTO[d.tipo] ?? d.tipo}{d.numero ? ` N.º ${d.numero}` : ''}</strong>
            {' · '}{d.placa ?? 'toda la carga'}
            <span className="ayuda" style={{ display: 'block', margin: 0 }}>
              {formatoHora(d.creado_en)}{d.subido_por ? ` · ${d.subido_por}` : ''}
            </span>
          </div>
          {enlaces[d.ruta] ? (
            <a className="boton secundario" href={enlaces[d.ruta]} target="_blank" rel="noreferrer">Ver</a>
          ) : (
            <span className="ayuda">No disponible</span>
          )}
        </li>
      ))}
    </ul>
  );
}
