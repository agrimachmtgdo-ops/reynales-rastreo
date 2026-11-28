/** Asterisco de campo obligatorio (igual que en Catálogos). */
export const Req = () => <span className="obligatorio" aria-hidden="true">*</span>;

/** Nota que explica el asterisco. */
export const NotaObligatorio = () => (
  <p className="ayuda"><span className="obligatorio" aria-hidden="true">*</span> Dato obligatorio.</p>
);
