'use client';
import { useState } from 'react';

/** Copia un texto (por ejemplo, el mensaje para WhatsApp) y confirma con «Copiado». */
export default function BotonCopiar({ texto, etiqueta = 'Copiar mensaje' }: { texto: string; etiqueta?: string }) {
  const [copiado, setCopiado] = useState(false);
  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      setCopiado(false);
    }
  }
  return (
    <button type="button" className="boton secundario" onClick={copiar} aria-live="polite">
      {copiado ? '✓ Copiado' : etiqueta}
    </button>
  );
}
