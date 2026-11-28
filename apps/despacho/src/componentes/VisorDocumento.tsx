'use client';
import { useRef, useState } from 'react';

/**
 * Botón «Ver»: abre el documento en una ventana dentro del panel, con «Descargar» y
 * «Abrir en otra pestaña». En pantallas chicas, los PDF se abren en otra pestaña
 * (el navegador del celular no los muestra dentro de la página).
 */
export default function VisorDocumento({ id, titulo, esPdf }: { id: string; titulo: string; esPdf: boolean }) {
  const ventana = useRef<HTMLDialogElement>(null);
  const [abierto, setAbierto] = useState(false);
  const url = `/documentos/${id}`;

  function abrir() {
    if (esPdf && window.matchMedia('(max-width: 760px)').matches) {
      window.open(url, '_blank', 'noopener');
      return;
    }
    setAbierto(true);
    ventana.current?.showModal();
  }
  function cerrar() {
    ventana.current?.close();
  }

  return (
    <>
      <button type="button" className="boton secundario" onClick={abrir}>Ver</button>
      <dialog ref={ventana} className="visor" aria-label={titulo} onClose={() => setAbierto(false)}>
        <div className="visor-barra">
          <strong>{titulo}</strong>
          <span className="visor-acciones">
            <a className="boton secundario" href={`${url}?descargar=1`}>Descargar</a>
            <a className="boton secundario" href={url} target="_blank" rel="noreferrer">Abrir en otra pestaña</a>
            <button type="button" className="boton" onClick={cerrar} autoFocus>Cerrar</button>
          </span>
        </div>
        {abierto && (esPdf
          ? <iframe className="visor-contenido" src={url} title={titulo} />
          // eslint-disable-next-line @next/next/no-img-element
          : <img className="visor-contenido visor-imagen" src={url} alt={titulo} />)}
      </dialog>
    </>
  );
}
