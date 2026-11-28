'use client';

/** Abre el diálogo de impresión: desde ahí se imprime o se guarda como PDF. */
export default function BotonImprimir() {
  return (
    <button type="button" className="boton secundario no-imprimir" onClick={() => window.print()}>
      Imprimir / guardar PDF
    </button>
  );
}
