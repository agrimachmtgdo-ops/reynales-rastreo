'use client';
import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { crearClienteNavegador } from '@/lib/supabase/client';
import { prepararArchivo } from '@/lib/comprimir';
import { TIPO_DOCUMENTO, type DatosDocumento } from '@/lib/documentos';

interface Props {
  misionId: string;
  /** Tipos que se pueden subir desde esta pantalla. */
  tipos: string[];
  camiones: { id: string; placa: string }[];
  /** Documentos vigentes que se pueden reemplazar por una versión nueva. */
  reemplazables: { id: string; texto: string }[];
  registrar: (datos: DatosDocumento) => Promise<{ ok: boolean; mensaje: string }>;
}

/**
 * Sube un CRT, MIC/DTA, foto u otro documento: el archivo va directo al almacenamiento
 * privado (carpeta de la misión) y después se registra en la base de datos.
 */
export default function SubirDocumento({ misionId, tipos, camiones, reemplazables, registrar }: Props) {
  const router = useRouter();
  const formulario = useRef<HTMLFormElement>(null);
  const [tipo, setTipo] = useState(tipos[0] ?? 'otro');
  const [estado, setEstado] = useState<{ ok: boolean; mensaje: string } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const pideNumero = tipo === 'crt' || tipo === 'mic_dta';

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const datos = new FormData(e.currentTarget);
    const archivo = datos.get('archivo');
    if (!(archivo instanceof File) || archivo.size === 0) {
      setEstado({ ok: false, mensaje: 'Elija la foto o el PDF del documento.' });
      return;
    }
    const numero = String(datos.get('numero') ?? '').trim();
    if (pideNumero && !numero) {
      setEstado({ ok: false, mensaje: `Escriba el número del ${TIPO_DOCUMENTO[tipo]}.` });
      return;
    }
    setEnviando(true);
    setEstado({ ok: true, mensaje: 'Preparando el archivo…' });
    try {
      const listo = await prepararArchivo(archivo);
      const ruta = `${misionId}/${crypto.randomUUID()}.${listo.extension}`;
      setEstado({ ok: true, mensaje: 'Subiendo…' });
      const { error } = await crearClienteNavegador().storage.from('documentos')
        .upload(ruta, listo.blob, { contentType: listo.tipo, upsert: false });
      if (error) throw new Error(`No se pudo subir el archivo: ${error.message}. Revise la señal e intente de nuevo.`);
      const r = await registrar({
        tipo,
        numero: numero || null,
        ruta,
        nombre: archivo.name || `${tipo}.${listo.extension}`,
        asignacionId: String(datos.get('asignacion') ?? '') || null,
        tipoMime: listo.tipo,
        tamano: listo.blob.size,
        reemplaza: String(datos.get('reemplaza') ?? '') || null,
      });
      setEstado(r);
      if (r.ok) {
        formulario.current?.reset();
        setTipo(tipos[0] ?? 'otro');
        router.refresh();
      }
    } catch (err) {
      setEstado({ ok: false, mensaje: err instanceof Error ? err.message : 'No se pudo subir el documento.' });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form ref={formulario} onSubmit={enviar} noValidate>
      {estado && <div role="status" className={estado.ok ? 'mensaje-ok' : 'mensaje-error'}>{estado.mensaje}</div>}
      <div className="rejilla">
        <label>
          Documento
          <select name="tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
            {tipos.map((t) => <option key={t} value={t}>{TIPO_DOCUMENTO[t] ?? t}</option>)}
          </select>
        </label>
        {pideNumero && (
          <label>
            Número <span className="obligatorio" aria-hidden="true">*</span>
            <input name="numero" required autoComplete="off" />
          </label>
        )}
        {camiones.length > 0 && (
          <label>
            Camión
            <select name="asignacion" defaultValue={camiones.length === 1 ? camiones[0]!.id : ''}>
              <option value="">Toda la carga</option>
              {camiones.map((c) => <option key={c.id} value={c.id}>{c.placa}</option>)}
            </select>
          </label>
        )}
        {reemplazables.length > 0 && (
          <label>
            Reemplaza a (opcional)
            <select name="reemplaza" defaultValue="">
              <option value="">Ninguno (documento nuevo)</option>
              {reemplazables.map((d) => <option key={d.id} value={d.id}>{d.texto}</option>)}
            </select>
          </label>
        )}
        <label>
          Foto o PDF <span className="obligatorio" aria-hidden="true">*</span>
          <input name="archivo" type="file" accept="image/*,application/pdf" required />
        </label>
      </div>
      <p className="ayuda">Las fotos se achican solas a menos de 1 MB. PDF hasta 10 MB.</p>
      <button className="boton" disabled={enviando}>{enviando ? 'Subiendo…' : 'Subir documento'}</button>
    </form>
  );
}
