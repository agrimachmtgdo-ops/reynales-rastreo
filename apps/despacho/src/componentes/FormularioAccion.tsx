'use client';
import { startTransition, useActionState, useEffect, useRef, type FormEvent } from 'react';

type Resultado = { ok: boolean; mensaje: string };

const ETAPAS_FINALES: Record<string, string> = { entregado: 'ENTREGADO', cancelado: 'CANCELADO' };

/**
 * Formulario genérico conectado a una acción de servidor, con mensaje de resultado.
 * Se envía con onSubmit (no con action=) para que React no vacíe los campos si hay un error:
 * solo se limpian cuando la acción termina bien.
 */
export default function FormularioAccion({
  accion,
  boton,
  children,
  claseBoton = 'boton',
  confirmarCierre = false,
}: {
  accion: (previo: Resultado | null, datos: FormData) => Promise<Resultado>;
  boton: string;
  children: React.ReactNode;
  claseBoton?: string;
  /** Pide confirmación y una nota obligatoria si la nueva etapa es Entregado o Cancelado. */
  confirmarCierre?: boolean;
}) {
  const [estado, enviar, pendiente] = useActionState(accion, null);
  const formulario = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (estado?.ok) formulario.current?.reset();
  }, [estado]);

  function alEnviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const datos = new FormData(e.currentTarget);
    if (confirmarCierre) {
      const final = ETAPAS_FINALES[String(datos.get('etapa') ?? '')];
      if (final) {
        const nota = String(datos.get('nota') ?? '').trim();
        if (!nota) {
          window.alert(`Para marcar ${final} a mano escriba una nota que explique el motivo (ej. "chofer confirmó por teléfono").`);
          (e.currentTarget.elements.namedItem('nota') as HTMLInputElement | null)?.focus();
          return;
        }
        const aviso = final === 'ENTREGADO'
          ? 'Se marcará ENTREGADO y la app del chofer dejará de enviar ubicación. Esto no se puede deshacer. ¿Continuar?'
          : 'Se CANCELARÁ este viaje y la app del chofer dejará de enviar ubicación. Esto no se puede deshacer. ¿Continuar?';
        if (!window.confirm(aviso)) return;
      }
    }
    startTransition(() => enviar(datos));
  }

  return (
    <form ref={formulario} onSubmit={alEnviar}>
      {estado && <div role="status" className={estado.ok ? 'mensaje-ok' : 'mensaje-error'}>{estado.mensaje}</div>}
      {children}
      <button className={claseBoton} disabled={pendiente}>{pendiente ? 'Procesando…' : boton}</button>
    </form>
  );
}
