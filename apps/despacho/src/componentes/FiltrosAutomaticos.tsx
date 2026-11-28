'use client';
import type { ChangeEvent } from 'react';

/**
 * Envía el formulario de filtros apenas cambia la etapa o una fecha (sin pulsar «Buscar»).
 * El texto de búsqueda se sigue enviando con Enter o con el botón.
 */
export default function FiltrosAutomaticos({ children, className }: { children: React.ReactNode; className?: string }) {
  function alCambiar(e: ChangeEvent<HTMLFormElement>) {
    const campo = e.target as unknown as HTMLInputElement | HTMLSelectElement;
    if (campo.name === 'etapa' || campo.type === 'date') {
      const form = e.currentTarget;
      const pagina = form.elements.namedItem('pagina');
      if (pagina instanceof HTMLInputElement) pagina.value = '';
      form.requestSubmit();
    }
  }
  return (
    <form className={className} role="search" method="get" onChange={alCambiar}>
      {children}
    </form>
  );
}
