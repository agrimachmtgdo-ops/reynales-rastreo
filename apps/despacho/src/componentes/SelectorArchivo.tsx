'use client';
import { useEffect, useMemo, useRef } from 'react';
import { MAXIMO_HOJAS } from '@/lib/comprimir';

/**
 * Elige el archivo de un documento: «Tomar foto» abre la cámara del celular y cada foto se
 * agrega como una hoja más; «Elegir archivo» toma un PDF o varias fotos. Muestra una
 * miniatura de cada hoja para confirmar que se lee bien. Varias fotos se unen en un PDF.
 */
export default function SelectorArchivo({
  archivos,
  alCambiar,
  deshabilitado = false,
  etiqueta = 'Foto o PDF',
}: {
  archivos: File[];
  alCambiar: (archivos: File[]) => void;
  deshabilitado?: boolean;
  etiqueta?: string;
}) {
  const camara = useRef<HTMLInputElement>(null);
  const elegir = useRef<HTMLInputElement>(null);
  const miniaturas = useMemo(
    () => archivos.map((a) => (a.type.startsWith('image/') ? URL.createObjectURL(a) : null)),
    [archivos],
  );
  useEffect(() => () => miniaturas.forEach((u) => u && URL.revokeObjectURL(u)), [miniaturas]);

  const esPdf = archivos.length === 1 && archivos[0]!.type === 'application/pdf';
  const agregar = (nuevos: FileList | null, reemplazar: boolean) => {
    if (!nuevos || nuevos.length === 0) return;
    const lista = Array.from(nuevos);
    const conPdf = lista.some((a) => a.type === 'application/pdf');
    // Un PDF reemplaza todo; las fotos se suman como hojas (hasta el máximo).
    const resultado = reemplazar || conPdf || esPdf ? lista : [...archivos, ...lista];
    alCambiar(resultado.slice(0, conPdf ? 1 : MAXIMO_HOJAS));
  };

  return (
    <div className="selector-archivo">
      <span className="selector-etiqueta">{etiqueta} <span className="obligatorio" aria-hidden="true">*</span></span>
      <div className="selector-botones">
        <button type="button" className="boton secundario" disabled={deshabilitado} onClick={() => camara.current?.click()}>
          {archivos.length > 0 && !esPdf ? 'Tomar otra hoja' : 'Tomar foto'}
        </button>
        <button type="button" className="boton secundario" disabled={deshabilitado} onClick={() => elegir.current?.click()}>
          Elegir archivo
        </button>
        <input ref={camara} type="file" accept="image/*" capture="environment" hidden
          onChange={(e) => { agregar(e.target.files, false); e.target.value = ''; }} />
        <input ref={elegir} type="file" accept="image/*,application/pdf" multiple hidden
          onChange={(e) => { agregar(e.target.files, true); e.target.value = ''; }} />
      </div>
      {archivos.length > 0 && (
        <>
          <ul className="miniaturas" aria-label="Hojas elegidas">
            {archivos.map((a, i) => (
              <li key={`${a.name}-${i}`}>
                {miniaturas[i] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={miniaturas[i]!} alt={`Hoja ${i + 1}`} />
                ) : (
                  <span className="miniatura-pdf" title={a.name}>PDF<br /><small>{a.name}</small></span>
                )}
                {!deshabilitado && (
                  <button type="button" className="quitar-hoja" aria-label={`Quitar hoja ${i + 1}`}
                    onClick={() => alCambiar(archivos.filter((_, j) => j !== i))}>×</button>
                )}
              </li>
            ))}
          </ul>
          <p className="ayuda">
            {esPdf ? 'PDF elegido (hasta 10 MB).'
              : archivos.length > 1 ? `${archivos.length} hojas: se unirán en un solo PDF.`
                : 'Revise que la foto se lea bien. Si el documento tiene más hojas, use «Tomar otra hoja».'}
          </p>
        </>
      )}
    </div>
  );
}
