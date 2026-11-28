'use client';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { PUNTOS_INSPECCION } from '@/lib/inspeccion';
import { subirConAvance } from '@/lib/subir';
import type { DatosInspeccion } from '@/app/(panel)/almacen/acciones';
import type { Resultado } from '@/app/(panel)/misiones/acciones';

const MAXIMO_FOTOS = 6;

/**
 * Inspección del camión antes de cargar (almacén, desde el celular): 6 puntos con Sí / No,
 * carga anterior, al menos 2 fotos (interior y lona) y el resultado. Las fotos se achican y
 * suben a la carpeta privada de la misión; después se registra la inspección.
 */
export default function FormularioInspeccion({
  asignacionId, misionId, registrar,
}: {
  asignacionId: string;
  misionId: string;
  registrar: (asignacionId: string, misionId: string, d: DatosInspeccion) => Promise<Resultado>;
}) {
  const router = useRouter();
  const [puntos, setPuntos] = useState<Record<string, boolean | undefined>>({});
  const [cargaAnterior, setCargaAnterior] = useState('');
  const [motivo, setMotivo] = useState('');
  const [fotos, setFotos] = useState<File[]>([]);
  const [estado, setEstado] = useState<{ tipo: 'ok' | 'error' | 'avance'; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const camara = useRef<HTMLInputElement>(null);
  const galeria = useRef<HTMLInputElement>(null);
  const miniaturas = useMemo(() => fotos.map((f) => URL.createObjectURL(f)), [fotos]);
  useEffect(() => () => miniaturas.forEach((u) => URL.revokeObjectURL(u)), [miniaturas]);

  const fallas = PUNTOS_INSPECCION.filter((p) => puntos[p.id] === false);
  const faltan = PUNTOS_INSPECCION.filter((p) => puntos[p.id] === undefined);

  const agregar = (lista: FileList | null) => {
    if (!lista) return;
    setFotos((prev) => [...prev, ...Array.from(lista).filter((f) => f.type.startsWith('image/'))].slice(0, MAXIMO_FOTOS));
  };

  async function enviar(resultado: 'aprobado' | 'rechazado', e?: FormEvent) {
    e?.preventDefault();
    setEstado(null);
    if (faltan.length) return setEstado({ tipo: 'error', texto: `Falta revisar: ${faltan.map((p) => p.texto).join(', ')}.` });
    if (resultado === 'aprobado' && fallas.length) {
      return setEstado({ tipo: 'error', texto: `No se puede aprobar: no cumple «${fallas.map((p) => p.texto).join('», «')}».` });
    }
    if (resultado === 'rechazado' && motivo.trim().length < 5) {
      return setEstado({ tipo: 'error', texto: 'Escriba el motivo del rechazo (qué hay que corregir).' });
    }
    if (fotos.length < 2) return setEstado({ tipo: 'error', texto: 'Agregue al menos 2 fotos: interior de la carrocería y lona.' });

    setOcupado(true);
    try {
      const { prepararArchivo } = await import('@/lib/comprimir');
      const rutas: string[] = [];
      for (const [n, foto] of fotos.entries()) {
        setEstado({ tipo: 'avance', texto: `Subiendo foto ${n + 1} de ${fotos.length}…` });
        const listo = await prepararArchivo(foto);
        const ruta = `${misionId}/insp-${crypto.randomUUID()}.${listo.extension}`;
        await subirConAvance(ruta, listo.blob, listo.tipo, () => {});
        rutas.push(ruta);
      }
      setEstado({ tipo: 'avance', texto: 'Guardando…' });
      const r = await registrar(asignacionId, misionId, {
        puntos: Object.fromEntries(PUNTOS_INSPECCION.map((p) => [p.id, puntos[p.id] === true])),
        cargaAnterior: cargaAnterior.trim() || null,
        resultado,
        motivo: motivo.trim() || null,
        fotos: rutas,
      });
      setEstado({ tipo: r.ok ? 'ok' : 'error', texto: r.mensaje });
      if (r.ok) {
        setPuntos({});
        setCargaAnterior('');
        setMotivo('');
        setFotos([]);
        router.refresh();
      }
    } catch (err) {
      setEstado({ tipo: 'error', texto: err instanceof Error ? err.message : 'No se pudo guardar la inspección.' });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <form className="inspeccion" onSubmit={(e) => enviar('aprobado', e)} noValidate>
      {estado && (
        <div role={estado.tipo === 'error' ? 'alert' : 'status'} className={estado.tipo === 'error' ? 'mensaje-error' : 'mensaje-ok'}>
          {estado.texto}
        </div>
      )}
      <fieldset className="puntos-inspeccion" disabled={ocupado}>
        <legend>Revise cada punto</legend>
        {PUNTOS_INSPECCION.map((p) => (
          <div key={p.id} className={`punto${puntos[p.id] === false ? ' falla' : ''}`} role="radiogroup" aria-label={p.texto}>
            <span>{p.texto}</span>
            <label><input type="radio" name={p.id} checked={puntos[p.id] === true} onChange={() => setPuntos((x) => ({ ...x, [p.id]: true }))} /> Sí</label>
            <label><input type="radio" name={p.id} checked={puntos[p.id] === false} onChange={() => setPuntos((x) => ({ ...x, [p.id]: false }))} /> No</label>
          </div>
        ))}
      </fieldset>
      <label><span className="etiqueta-campo">¿Qué llevó antes este camión?</span>
        <input value={cargaAnterior} onChange={(e) => setCargaAnterior(e.target.value)} maxLength={120} placeholder="Ej. soya en grano" disabled={ocupado} />
      </label>

      <div className="fotos-inspeccion">
        <span className="etiqueta-campo">Fotos (mínimo 2: interior de la carrocería y lona)</span>
        <div className="botones-fotos">
          <button type="button" className="boton secundario" onClick={() => camara.current?.click()} disabled={ocupado || fotos.length >= MAXIMO_FOTOS}>Tomar foto</button>
          <button type="button" className="boton secundario" onClick={() => galeria.current?.click()} disabled={ocupado || fotos.length >= MAXIMO_FOTOS}>Elegir fotos</button>
        </div>
        <input ref={camara} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { agregar(e.target.files); e.target.value = ''; }} />
        <input ref={galeria} type="file" accept="image/*" multiple hidden onChange={(e) => { agregar(e.target.files); e.target.value = ''; }} />
        {fotos.length > 0 && (
          <ul className="miniaturas">
            {miniaturas.map((u, i) => (
              <li key={u}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={u} alt={`Foto ${i + 1}`} />
                <button type="button" className="boton boton-chico secundario" disabled={ocupado}
                  onClick={() => setFotos((prev) => prev.filter((_, j) => j !== i))}>Quitar</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {fallas.length > 0 && (
        <label><span className="etiqueta-campo">Motivo del rechazo <span className="obligatorio" aria-hidden="true">*</span></span>
          <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} rows={2}
            placeholder="Qué hay que corregir antes de cargar" disabled={ocupado} />
        </label>
      )}

      <div className="acciones-inspeccion">
        {fallas.length === 0 ? (
          <button className="boton" disabled={ocupado}>{ocupado ? 'Guardando…' : 'Aprobar: se puede cargar'}</button>
        ) : (
          <button type="button" className="boton peligro" disabled={ocupado} onClick={() => enviar('rechazado')}>
            {ocupado ? 'Guardando…' : 'Rechazar el camión'}
          </button>
        )}
      </div>
    </form>
  );
}
