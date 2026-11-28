'use client';
import { useEffect } from 'react';

/** Pantalla amable cuando una página del panel falla (p. ej. se cortó internet). */
export default function ErrorPanel({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <section className="tarjeta" role="alert">
      <h1>No se pudo mostrar esta página</h1>
      <p>Puede ser un corte momentáneo de internet o del servidor. Los datos de los camiones siguen guardándose.</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="boton" onClick={() => reset()}>Reintentar</button>
        <button type="button" className="boton secundario" onClick={() => window.location.reload()}>Recargar la página</button>
      </div>
      {error.digest && <p style={{ fontSize: 13, color: 'var(--gris)' }}>Código del error: {error.digest}</p>}
    </section>
  );
}
