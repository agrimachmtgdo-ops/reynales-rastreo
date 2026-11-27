'use client';
import Link from 'next/link';
import { useActionState, useEffect, useRef } from 'react';

type Resultado = { ok: boolean; mensaje: string };

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

  return (
    <form ref={formulario} action={enviar} style={{ marginBottom: 16 }}>
      {estado && <div role="status" className={estado.ok ? 'mensaje-ok' : 'mensaje-error'}>{estado.mensaje}</div>}
      <div className="rejilla">{children}</div>
      <button className="boton" disabled={pendiente}>{pendiente ? 'Guardando…' : boton}</button>
      {cancelar && <Link href={cancelar} className="enlace-cancelar">Cancelar</Link>}
    </form>
  );
}
