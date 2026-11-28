'use client';
import { startTransition, useActionState, useEffect, useRef, useState, type DragEvent, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { nombrePais } from '@reynales/shared';
import { useErrorCampo, validarObligatorios } from './errorCampo';
import SelectorArchivo from './SelectorArchivo';
import {
  CLAVES_DESPACHO, estadoDocumentos, sugerirDesdeNombre, TIPO_DOCUMENTO, type ClaveDocumento, type DatosDocumento,
} from '@/lib/documentos';
import { subirDocumento, textoEstado, type EstadoSubida } from '@/lib/subir';

interface Resultado {
  ok: boolean;
  mensaje: string;
  campo?: string;
  errorCampo?: string;
  misionId?: string;
  codigo?: string;
  aviso?: 'factura_repetida';
}

interface Fila {
  id: string;
  clave: ClaveDocumento;
  numero: string;
  archivos: File[];
  estado: EstadoSubida | null;
}

/** Campos de la misión que se llenan con el número del documento (un solo ingreso). */
const CAMPO_DE: Partial<Record<ClaveDocumento, string>> = { factura: 'factura', dex: 'dex', guia: 'guia' };
const nuevaFila = (clave: ClaveDocumento = 'factura', numero = '', archivos: File[] = []): Fila =>
  ({ id: crypto.randomUUID(), clave, numero, archivos, estado: null });

/**
 * «Nueva misión» con documentos: primero se crea la misión y luego se suben los archivos a
 * su carpeta privada, cada uno con su avance. Si un archivo falla, la misión ya quedó creada:
 * se puede reintentar aquí mismo o subirlo después desde el detalle.
 */
export default function FormularioNuevaMision({
  accion,
  registrar,
  destinos,
  envio,
  resto,
}: {
  accion: (previo: Resultado | null, datos: FormData) => Promise<Resultado>;
  registrar: (misionId: string, datos: DatosDocumento) => Promise<{ ok: boolean; mensaje: string }>;
  destinos: { id: string; pais: string }[];
  /** Campos del envío (van antes de los documentos). */
  envio: ReactNode;
  /** Transbordo y primer camión (van después de los documentos). */
  resto: ReactNode;
}) {
  const router = useRouter();
  const formulario = useRef<HTMLFormElement>(null);
  const [estado, enviar, pendiente] = useActionState(accion, null);
  const [filas, setFilas] = useState<Fila[]>([nuevaFila()]);
  const [pais, setPais] = useState<string | null>(null);
  const [creada, setCreada] = useState<{ id: string; codigo: string } | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [avisoDocs, setAvisoDocs] = useState<string | null>(null);
  const [arrastrando, setArrastrando] = useState(false);
  const [pedirFacturaIgual, setPedirFacturaIgual] = useState(false);
  useErrorCampo(formulario, estado);

  const cambiarFila = (id: string, cambios: Partial<Fila>) =>
    setFilas((lista) => lista.map((f) => (f.id === id ? { ...f, ...cambios } : f)));
  const valorCampo = (nombre: string) =>
    (formulario.current?.elements.namedItem(nombre) as HTMLInputElement | null)?.value.trim() ?? '';

  // Al elegir el tipo, el número se toma del campo de la misión si ya está escrito (un solo ingreso).
  function elegirTipo(fila: Fila, clave: ClaveDocumento) {
    const campo = CAMPO_DE[clave];
    cambiarFila(fila.id, { clave, numero: fila.numero || (campo ? valorCampo(campo) : '') });
  }

  function agregarArchivosSueltos(lista: FileList | null) {
    if (!lista || lista.length === 0) return;
    const nuevas = Array.from(lista).map((a) => {
      const s = sugerirDesdeNombre(a.name);
      return nuevaFila(s.clave, s.numero, [a]);
    });
    // Reemplaza la fila vacía inicial si no tiene nada.
    setFilas((actual) => [...actual.filter((f) => f.archivos.length > 0 || f.numero), ...nuevas]);
  }

  function alSoltar(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setArrastrando(false);
    agregarArchivosSueltos(e.dataTransfer.files);
  }

  async function subirPendientes(misionId: string, codigo: string) {
    setSubiendo(true);
    setAvisoDocs(null);
    const pendientes = filas.filter((f) => f.archivos.length > 0 && f.estado?.fase !== 'listo');
    pendientes.forEach((f) => cambiarFila(f.id, { estado: { fase: 'en_cola' } }));
    let fallidos = 0;
    for (const f of pendientes) {
      const ok = await subirDocumento({
        misionId, archivos: f.archivos, clave: f.clave, numero: f.numero,
        registrar: (d) => registrar(misionId, d),
        alCambiar: (e) => cambiarFila(f.id, { estado: e }),
      });
      if (!ok) fallidos++;
    }
    setSubiendo(false);
    if (fallidos === 0) {
      router.push(`/misiones/${misionId}`);
    } else {
      setAvisoDocs(`La misión ${codigo} ya está creada, pero ${fallidos === 1 ? '1 documento no se subió' : `${fallidos} documentos no se subieron`}. `
        + 'Pulse «Reintentar» o súbalo después desde el detalle de la misión.');
    }
  }

  // Cuando la misión queda creada, se suben los documentos (aunque haya fallado un paso posterior).
  useEffect(() => {
    if (estado?.aviso === 'factura_repetida') setPedirFacturaIgual(true);
    if (!estado?.misionId || creada) return;
    const nueva = { id: estado.misionId, codigo: estado.codigo ?? '' };
    setCreada(nueva);
    const conArchivo = filas.some((f) => f.archivos.length > 0);
    if (!conArchivo && estado.ok) router.push(`/misiones/${nueva.id}`);
    else if (conArchivo) void subirPendientes(nueva.id, nueva.codigo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  function alEnviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (creada) return;
    const form = e.currentTarget;
    setAvisoDocs(null);
    if (!validarObligatorios(form)) return;
    const sinArchivo = filas.findIndex((f) => f.archivos.length === 0 && f.numero.trim() !== '');
    if (sinArchivo >= 0) {
      setAvisoDocs(`Al documento ${sinArchivo + 1} (${TIPO_DOCUMENTO[filas[sinArchivo]!.clave]}) le falta el archivo. Agréguelo o quite la fila.`);
      return;
    }
    // Un solo ingreso: el número del documento completa el campo vacío de la misión.
    for (const f of filas) {
      const campo = CAMPO_DE[f.clave];
      const control = campo ? (form.elements.namedItem(campo) as HTMLInputElement | null) : null;
      if (control && !control.value.trim() && f.numero.trim()) control.value = f.numero.trim();
    }
    startTransition(() => enviar(new FormData(form)));
  }

  const requeridos = estadoDocumentos(filas.filter((f) => f.archivos.length > 0).map((f) => f.clave), pais);
  const conArchivo = filas.filter((f) => f.archivos.length > 0);
  const listos = conArchivo.filter((f) => f.estado?.fase === 'listo').length;
  const bloqueado = pendiente || subiendo || creada !== null;

  return (
    <form
      ref={formulario}
      onSubmit={alEnviar}
      noValidate
      onChange={(e) => {
        const t = e.target as unknown as HTMLSelectElement;
        if (t.name === 'destino_id') setPais(destinos.find((d) => d.id === t.value)?.pais ?? null);
      }}
    >
      {estado && !(estado.ok && creada) && (
        <div role="status" className={estado.ok ? 'mensaje-ok' : 'mensaje-error'}>{estado.mensaje}</div>
      )}
      {envio}
      {pedirFacturaIgual && !creada && (
        <label className="casilla"><input type="checkbox" name="factura_igual" /> Factura repetida: crear igual</label>
      )}

      <h2>Documentos</h2>
      <p className="lista-requeridos" aria-live="polite">
        {pais ? <>Para {nombrePais(pais)}: </> : <>Elija el destino para ver los requeridos: </>}
        {requeridos.map((r, i) => (
          <span key={r.clave} className={r.tiene ? 'requerido-listo' : ''}>
            {i > 0 && ' · '}{r.nombre}{r.obligatorio ? '' : ' (opcional)'} {r.tiene ? '☑' : '☐'}
          </span>
        ))}
      </p>
      <p className="ayuda">Puede crear la misión sin documentos y subirlos después. Si el camión sale de fábrica sin ellos, se avisa a despacho.</p>

      <div
        className={`zona-soltar${arrastrando ? ' activa' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }}
        onDragLeave={() => setArrastrando(false)}
        onDrop={alSoltar}
      >
        <p style={{ margin: 0 }}>
          Arrastre aquí varios archivos a la vez, o{' '}
          <label className="enlace-archivo">
            elíjalos
            <input type="file" accept="image/*,application/pdf" multiple hidden disabled={bloqueado}
              onChange={(e) => { agregarArchivosSueltos(e.target.files); e.target.value = ''; }} />
          </label>
          . El tipo se sugiere por el nombre del archivo; revíselo.
        </p>
      </div>

      {conArchivo.length > 0 && (subiendo || creada) && (
        <p role="status"><strong>{listos} de {conArchivo.length} documentos subidos</strong></p>
      )}

      <ol className="filas-documento">
        {filas.map((f, i) => (
          <li key={f.id} className="fila-documento">
            <div className="rejilla">
              <label>
                Documento {i + 1}
                <select value={f.clave} onChange={(e) => elegirTipo(f, e.target.value as ClaveDocumento)}
                  disabled={bloqueado || f.estado?.fase === 'listo'}>
                  {CLAVES_DESPACHO.map((c) => <option key={c} value={c}>{TIPO_DOCUMENTO[c]}</option>)}
                </select>
              </label>
              <label>
                Número <span className="ayuda">(opcional)</span>
                <input value={f.numero} onChange={(e) => cambiarFila(f.id, { numero: e.target.value })} autoComplete="off"
                  disabled={bloqueado || f.estado?.fase === 'listo'} />
              </label>
            </div>
            <SelectorArchivo archivos={f.archivos} alCambiar={(archivos) => cambiarFila(f.id, { archivos })}
              deshabilitado={bloqueado || f.estado?.fase === 'listo'} />
            <div className="fila-documento-pie">
              {f.estado && (
                <span role="status" className={`estado-subida ${f.estado.fase}`}>
                  {textoEstado(f.estado)}
                  {f.estado.fase === 'subiendo' && <progress max={100} value={f.estado.avance} className="avance" />}
                </span>
              )}
              {!creada && filas.length > 1 && (
                <button type="button" className="boton-texto" onClick={() => setFilas((l) => l.filter((x) => x.id !== f.id))}>
                  Quitar documento {i + 1}
                </button>
              )}
            </div>
          </li>
        ))}
      </ol>
      {!creada && (
        <button type="button" className="boton secundario" onClick={() => setFilas((l) => [...l, nuevaFila('dex')])} disabled={bloqueado}>
          + Agregar otro documento
        </button>
      )}
      {avisoDocs && <div role="alert" className="mensaje-error" style={{ marginTop: 12 }}>{avisoDocs}</div>}

      {resto}

      {creada ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
          {!subiendo && conArchivo.some((f) => f.estado?.fase === 'error') && (
            <button type="button" className="boton" onClick={() => void subirPendientes(creada.id, creada.codigo)}>Reintentar</button>
          )}
          <Link className="boton secundario" href={`/misiones/${creada.id}`}>Ir a la misión {creada.codigo}</Link>
        </div>
      ) : (
        <button className="boton" disabled={bloqueado}>{pendiente ? 'Creando la misión…' : 'Crear misión'}</button>
      )}
    </form>
  );
}
