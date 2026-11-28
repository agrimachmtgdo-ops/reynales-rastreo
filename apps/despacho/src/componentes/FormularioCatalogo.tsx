'use client';
import Link from 'next/link';
import { startTransition, useActionState, useEffect, useRef, type FormEvent } from 'react';

import { useErrorCampo, validarObligatorios, type ResultadoFormulario as Resultado } from './errorCampo';

export default function FormularioCatalogo({
  accion,
  boton,
  cancelar,
  children,
}: {
  accion: (previo: Resultado | null, datos: FormData) => Promise<Resultado>;
  boton: string;
  /** Enlace para salir sin guardar (formulario de edición). */
  cancelar?: string;
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

  return (
    <form ref={formulario} onSubmit={alEnviar} noValidate style={{ marginBottom: 16 }}>
      {estado && <div role="status" className={estado.ok ? 'mensaje-ok' : 'mensaje-error'}>{estado.mensaje}</div>}
      <div className="rejilla">{children}</div>
      <button className="boton" disabled={pendiente}>{pendiente ? 'Guardando…' : boton}</button>
      {cancelar && <Link href={cancelar} className="enlace-cancelar">Cancelar</Link>}
    </form>
  );
}
