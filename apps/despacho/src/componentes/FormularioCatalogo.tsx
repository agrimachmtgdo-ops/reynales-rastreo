'use client';
import { useActionState, useEffect, useRef } from 'react';

type Resultado = { ok: boolean; mensaje: string };

export default function FormularioCatalogo({
  accion,
  boton,
  children,
}: {
  accion: (previo: Resultado | null, datos: FormData) => Promise<Resultado>;
  boton: string;
  children: React.ReactNode;
}) {
  const [estado, enviar, pendiente] = useActionState(accion, null);
  const formulario = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (estado?.ok) formulario.current?.reset();
  }, [estado]);

  return (
    <form ref={formulario} action={enviar} style={{ marginBottom: 16 }}>
      {estado && <div className={estado.ok ? 'mensaje-ok' : 'mensaje-error'}>{estado.mensaje}</div>}
      <div className="rejilla">{children}</div>
      <button className="boton" disabled={pendiente}>{pendiente ? 'Guardando…' : boton}</button>
    </form>
  );
}
