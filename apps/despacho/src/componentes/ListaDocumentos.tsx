import { formatoHora } from '@/lib/tipos';
import { nombreDocumento, type DocumentoVigente } from '@/lib/documentos';
import VisorDocumento from './VisorDocumento';

/** Documentos vigentes. «Ver» los abre dentro del panel y deja constancia de quién los abrió. */
export default function ListaDocumentos({ documentos }: { documentos: DocumentoVigente[] }) {
  if (documentos.length === 0) return <p>Todavía no hay documentos.</p>;
  return (
    <ul className="lista-documentos">
      {documentos.map((d) => {
        const titulo = `${nombreDocumento(d.tipo, d.etiqueta)}${d.numero ? ` N.º ${d.numero}` : ''}`;
        return (
          <li key={d.id}>
            <div>
              <strong>{titulo}</strong>
              {' · '}{d.placa ?? 'toda la carga'}
              <span className="ayuda" style={{ display: 'block', margin: 0 }}>
                {formatoHora(d.creado_en)}{d.subido_por ? ` · ${d.subido_por}` : ''}
              </span>
            </div>
            <VisorDocumento id={d.id} titulo={titulo} esPdf={d.tipo_mime === 'application/pdf' || /\.pdf$/i.test(d.ruta)} />
          </li>
        );
      })}
    </ul>
  );
}
