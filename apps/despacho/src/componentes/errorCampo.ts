'use client';
import { useEffect, type RefObject } from 'react';

export type ResultadoFormulario = { ok: boolean; mensaje: string; campo?: string; errorCampo?: string };
type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/** Quita los errores mostrados junto a los campos. */
function limpiarErrores(form: HTMLFormElement) {
  form.querySelectorAll('.error-campo').forEach((n) => n.remove());
  form.querySelectorAll('[aria-invalid="true"]').forEach((n) => {
    n.removeAttribute('aria-invalid');
    n.removeAttribute('aria-describedby');
  });
}

/** Pone el mensaje debajo del campo y lo marca como inválido. */
function marcarError(campo: Control, mensaje: string) {
  const id = `error-${campo.name}`;
  const aviso = document.createElement('span');
  aviso.className = 'error-campo';
  aviso.id = id;
  aviso.setAttribute('role', 'alert');
  aviso.textContent = mensaje;
  campo.setAttribute('aria-invalid', 'true');
  campo.setAttribute('aria-describedby', id);
  campo.insertAdjacentElement('afterend', aviso);
}

/**
 * Revisa los campos obligatorios antes de enviar y muestra «Dato obligatorio» junto a cada uno
 * que falte (también en las listas que aún están deshabilitadas). Devuelve false si falta alguno.
 */
export function validarObligatorios(form: HTMLFormElement): boolean {
  limpiarErrores(form);
  const faltan = Array.from(form.querySelectorAll<Control>('input[required], select[required], textarea[required]'))
    .filter((c) => c.disabled || c.value.trim() === '');
  faltan.forEach((c) =>
    marcarError(c, c.disabled ? 'Dato obligatorio: elija primero el dato anterior.' : 'Dato obligatorio.'),
  );
  const primero = faltan.find((c) => !c.disabled) ?? faltan[0];
  primero?.focus();
  return faltan.length === 0;
}

/**
 * Muestra el error que devolvió el servidor junto al campo que lo causó (por ejemplo, un teléfono
 * sin código de país): marca el campo como inválido, pone el mensaje debajo y lleva el cursor ahí.
 */
export function useErrorCampo(formulario: RefObject<HTMLFormElement | null>, estado: ResultadoFormulario | null) {
  useEffect(() => {
    const form = formulario.current;
    if (!form || !estado) return;
    limpiarErrores(form);
    if (estado.ok || !estado.campo) return;
    const campo = form.elements.namedItem(estado.campo);
    if (!(campo instanceof HTMLInputElement || campo instanceof HTMLSelectElement || campo instanceof HTMLTextAreaElement)) return;
    marcarError(campo, estado.errorCampo ?? estado.mensaje);
    campo.focus();
  }, [formulario, estado]);
}
