'use client';
import { useEffect, type RefObject } from 'react';

export type ResultadoFormulario = { ok: boolean; mensaje: string; campo?: string; errorCampo?: string };

/**
 * Muestra el error junto al campo que lo causó (por ejemplo, un teléfono sin código de país):
 * marca el campo como inválido, pone el mensaje debajo y lleva el cursor ahí.
 */
export function useErrorCampo(formulario: RefObject<HTMLFormElement | null>, estado: ResultadoFormulario | null) {
  useEffect(() => {
    const form = formulario.current;
    if (!form) return;
    form.querySelectorAll('.error-campo').forEach((n) => n.remove());
    form.querySelectorAll('[aria-invalid="true"]').forEach((n) => {
      n.removeAttribute('aria-invalid');
      n.removeAttribute('aria-describedby');
    });
    if (!estado || estado.ok || !estado.campo) return;
    const campo = form.elements.namedItem(estado.campo);
    if (!(campo instanceof HTMLInputElement || campo instanceof HTMLSelectElement || campo instanceof HTMLTextAreaElement)) return;
    const id = `error-${estado.campo}`;
    const aviso = document.createElement('span');
    aviso.className = 'error-campo';
    aviso.id = id;
    aviso.textContent = estado.errorCampo ?? estado.mensaje;
    campo.setAttribute('aria-invalid', 'true');
    campo.setAttribute('aria-describedby', id);
    campo.insertAdjacentElement('afterend', aviso);
    campo.focus();
  }, [formulario, estado]);
}
