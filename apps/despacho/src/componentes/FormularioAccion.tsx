'use client';
import { useActionState } from 'react';

type Resultado = { ok: boolean; mensaje: string };

/** Formulario genérico conectado a una acción de servidor, con mensaje de resultado. */
export default function FormularioAccion({
  accion,
  boton,
  children,
  claseBoton = 'boton',
}: {
  accion: (previo: Resultado | null, datos: FormData) => Promise<Resultado>;
  boton: string;
  children: React.ReactNode;
  claseBoton?: string;
}) {
  const [estado, enviar, pendiente] = useActionState(accion, null);
  return (
    <form action={enviar}>
      {estado && <div className={estado.ok ? 'mensaje-ok' : 'mensaje-error'}>{estado.mensaje}</div>}
      {children}
      <button className={claseBoton} disabled={pendiente}>{pendiente ? 'Procesando…' : boton}</button>
    </form>
  );
}
