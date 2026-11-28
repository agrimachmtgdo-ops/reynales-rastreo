'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { PIDEN_NUMERO, TIPO_DOCUMENTO, type ClaveDocumento, type DatosDocumento } from '@/lib/documentos';
import { subirDocumento, textoEstado, type EstadoSubida } from '@/lib/subir';
import SelectorArchivo from './SelectorArchivo';

interface Props {
  misionId: string;
  /** Tipos que se pueden subir desde esta pantalla (claves de documento). */
  tipos: ClaveDocumento[];
  camiones: { id: string; placa: string }[];
  /** Documentos vigentes que se pueden reemplazar por una versión nueva. */
  reemplazables: { id: string; texto: string }[];
  registrar: (datos: DatosDocumento) => Promise<{ ok: boolean; mensaje: string }>;
}

/**
 * Sube un documento a una misión que ya existe: el archivo va directo al almacenamiento
 * privado (carpeta de la misión) con su avance a la vista, y después se registra.
 * Si falla, el formulario conserva lo elegido para reintentar.
 */
export default function SubirDocumento({ misionId, tipos, camiones, reemplazables, registrar }: Props) {
  const router = useRouter();
  const [clave, setClave] = useState<ClaveDocumento>(tipos[0] ?? 'otro');
  const [numero, setNumero] = useState('');
  const [camion, setCamion] = useState(camiones.length === 1 ? camiones[0]!.id : '');
  const [reemplaza, setReemplaza] = useState('');
  const [archivos, setArchivos] = useState<File[]>([]);
  const [estado, setEstado] = useState<EstadoSubida | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const pideNumero = PIDEN_NUMERO.includes(clave);
  const ocupado = estado !== null && ['preparando', 'subiendo', 'guardando'].includes(estado.fase);

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setAviso(null);
    if (archivos.length === 0) {
      setAviso('Tome la foto o elija el PDF del documento.');
      return;
    }
    if (pideNumero && !numero.trim()) {
      setAviso(`Escriba el número del ${TIPO_DOCUMENTO[clave]}.`);
      return;
    }
    const ok = await subirDocumento({
      misionId, archivos, clave, numero, asignacionId: camion || null, reemplaza: reemplaza || null,
      registrar, alCambiar: setEstado,
    });
    if (ok) {
      setArchivos([]);
      setNumero('');
      setReemplaza('');
      router.refresh();
    }
  }

  return (
    <form onSubmit={enviar} noValidate>
      {aviso && <div role="alert" className="mensaje-error">{aviso}</div>}
      {estado && (
        <div role="status" className={estado.fase === 'error' ? 'mensaje-error' : 'mensaje-ok'}>
          {estado.fase === 'listo' ? estado.mensaje : textoEstado(estado)}
          {estado.fase === 'subiendo' && <progress max={100} value={estado.avance} className="avance" />}
        </div>
      )}
      <div className="rejilla">
        <label>
          Documento
          <select value={clave} onChange={(e) => setClave(e.target.value as ClaveDocumento)} disabled={ocupado}>
            {tipos.map((t) => <option key={t} value={t}>{TIPO_DOCUMENTO[t] ?? t}</option>)}
          </select>
        </label>
        <label>
          Número {pideNumero ? <span className="obligatorio" aria-hidden="true">*</span> : <span className="ayuda">(opcional)</span>}
          <input value={numero} onChange={(e) => setNumero(e.target.value)} autoComplete="off" required={pideNumero} disabled={ocupado} />
        </label>
        {camiones.length > 0 && (
          <label>
            Camión
            <select value={camion} onChange={(e) => setCamion(e.target.value)} disabled={ocupado}>
              <option value="">Toda la carga</option>
              {camiones.map((c) => <option key={c.id} value={c.id}>{c.placa}</option>)}
            </select>
          </label>
        )}
        {reemplazables.length > 0 && (
          <label>
            Reemplaza a (opcional)
            <select value={reemplaza} onChange={(e) => setReemplaza(e.target.value)} disabled={ocupado}>
              <option value="">Ninguno (documento nuevo)</option>
              {reemplazables.map((d) => <option key={d.id} value={d.id}>{d.texto}</option>)}
            </select>
          </label>
        )}
      </div>
      <SelectorArchivo archivos={archivos} alCambiar={setArchivos} deshabilitado={ocupado} />
      <p className="ayuda">Las fotos se achican solas a menos de 1 MB por hoja. PDF hasta 10 MB.</p>
      <button className="boton" disabled={ocupado}>
        {ocupado ? 'Subiendo…' : estado?.fase === 'error' ? 'Reintentar' : 'Subir documento'}
      </button>
    </form>
  );
}
