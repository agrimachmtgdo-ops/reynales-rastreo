'use client';
import Link from 'next/link';
import { startTransition, useActionState, useEffect, useRef, type FormEvent } from 'react';

import { useErrorCampo, validarObligatorios, type ResultadoFormulario as Resultado } from './errorCampo';

export default function FormularioCatalogo({
  accion,
  boton,
  cancelar,
  secciones = false,
  children,
}: {
  accion: (previo: Resultado | null, datos: FormData) => Promise<Resultado>;
  boton: string;
  /** Enlace para salir sin guardar (formulario de edición). */
  cancelar?: string;
  /**
   * Diseño por secciones: los hijos traen sus propios fieldset (sin rejilla común) y el pie lleva
   * «Dato obligatorio», Cancelar y Guardar alineados. Cancelar sin enlace limpia y cierra el panel.
   */
  secciones?: boolean;
  children: React.ReactNode;
}) {
  const [estado, enviar, pendiente] = useActionState(accion, null);
  const formulario = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (estado?.ok) formulario.current?.reset();
  }, [estado]);
  useErrorCampo(formulario, estado);

  // onSubmit en lugar de action=: React no vacía los campos si el guardado falla.
  function alEnviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!validarObligatorios(e.currentTarget)) return;
    const datos = new FormData(e.currentTarget);
    startTransition(() => enviar(datos));
  }

  const mensaje = estado && <div role="status" className={estado.ok ? 'mensaje-ok' : 'mensaje-error'}>{estado.mensaje}</div>;

  if (secciones) {
    return (
      <form ref={formulario} onSubmit={alEnviar} noValidate>
        {mensaje}
        <div className="form-secciones">{children}</div>
        <div className="pie-form pie-catalogo">
          <p className="nota-obligatorio"><span className="obligatorio" aria-hidden="true">*</span> Dato obligatorio</p>
          {cancelar ? (
            <Link href={cancelar} className="boton-cancelar">Cancelar</Link>
          ) : (
            <button type="button" className="boton-cancelar" disabled={pendiente}
              onClick={(e) => { formulario.current?.reset(); e.currentTarget.closest('details')?.removeAttribute('open'); }}>
              Cancelar
            </button>
          )}
          <button className="boton" disabled={pendiente}>{pendiente ? 'Guardando…' : boton}</button>
        </div>
      </form>
    );
  }

  return (
    <form ref={formulario} onSubmit={alEnviar} noValidate style={{ marginBottom: 16 }}>
      {mensaje}
      <div className="rejilla">{children}</div>
      <button className="boton" disabled={pendiente}>{pendiente ? 'Guardando…' : boton}</button>
      {cancelar && <Link href={cancelar} className="enlace-cancelar">Cancelar</Link>}
    </form>
  );
}
