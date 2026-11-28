'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition, type FormEvent } from 'react';
import { Req } from './Obligatorio';
import { guardarPedido, type DatosPedido, type EnvioNuevo } from '@/app/(panel)/pedidos/acciones';
import { formatoToneladas, hitoPorIncoterm, INCOTERMS, NOMBRE_HITO } from '@/lib/pedidos';

export interface OpcionCliente { id: string; razon_social: string }
export interface OpcionUbicacion { id: string; nombre: string; ciudad: string | null; pais: string }
interface FilaEnvio { clave: number; toneladas: string; entrega: string; carga: string }
interface ErrorForm { campo: string; mensaje: string }

const INCOTERMS_FRECUENTES = ['CPT', 'FCA', 'FOB'];

/**
 * Formulario del pedido con su programa de envíos (una fila por camión o entrega parcial).
 * Valida al salir de cada campo y, al guardar, muestra un resumen de errores con enlaces a cada campo.
 */
export default function FormularioPedido({
  id, clientes, ubicaciones, inicial, envios: enviosIniciales,
}: {
  id: string | null;
  clientes: OpcionCliente[];
  ubicaciones: OpcionUbicacion[];
  inicial?: Partial<DatosPedido>;
  envios?: EnvioNuevo[];
}) {
  const router = useRouter();
  const contador = useRef(0);
  const nuevaFila = (e?: EnvioNuevo): FilaEnvio => ({
    clave: ++contador.current,
    toneladas: e ? String(e.toneladas) : '',
    entrega: e?.entrega ?? '',
    carga: e?.carga ?? '',
  });
  const [datos, setDatos] = useState({
    cliente_id: inicial?.cliente_id ?? '',
    orden_compra: inicial?.orden_compra ?? '',
    producto: inicial?.producto ?? '',
    destino_id: inicial?.destino_id ?? '',
    incoterm: inicial?.incoterm ?? '',
    notas: inicial?.notas ?? '',
  });
  const [filas, setFilas] = useState<FilaEnvio[]>(() =>
    enviosIniciales?.length ? enviosIniciales.map(nuevaFila) : [nuevaFila()]);
  const [errores, setErrores] = useState<ErrorForm[]>([]);
  const [tocados, setTocados] = useState<Set<string>>(new Set());
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();
  const resumen = useRef<HTMLDivElement>(null);

  const numero = (t: string) => Number(t.replace(',', '.'));
  const total = filas.reduce((s, f) => s + (numero(f.toneladas) > 0 ? numero(f.toneladas) : 0), 0);

  function validar(): ErrorForm[] {
    const e: ErrorForm[] = [];
    if (!datos.cliente_id) e.push({ campo: 'cliente_id', mensaje: 'Elija el cliente.' });
    if (!datos.producto.trim()) e.push({ campo: 'producto', mensaje: 'Escriba el producto.' });
    if (!datos.destino_id) e.push({ campo: 'destino_id', mensaje: 'Elija el destino.' });
    if (!datos.incoterm) e.push({ campo: 'incoterm', mensaje: 'Elija el Incoterm.' });
    filas.forEach((f, i) => {
      const n = i + 1;
      if (!(numero(f.toneladas) > 0)) e.push({ campo: `toneladas-${f.clave}`, mensaje: `Envío ${n}: escriba las toneladas (mayor que 0).` });
      if (!f.entrega) e.push({ campo: `entrega-${f.clave}`, mensaje: `Envío ${n}: elija la fecha de entrega.` });
      if (f.carga && f.entrega && f.carga > f.entrega) e.push({ campo: `carga-${f.clave}`, mensaje: `Envío ${n}: la carga no puede ser después de la entrega.` });
    });
    return e;
  }
  const errorDe = (campo: string) => (tocados.has(campo) ? errores.find((x) => x.campo === campo)?.mensaje : undefined);
  function alSalir(campo: string) {
    setTocados((t) => new Set(t).add(campo));
    setErrores(validar());
  }
  const props = (campo: string) => {
    const err = errorDe(campo);
    return {
      id: campo, name: campo, onBlur: () => alSalir(campo),
      'aria-invalid': err ? true : undefined, 'aria-describedby': err ? `error-${campo}` : undefined,
    };
  };
  const aviso = (campo: string) => {
    const err = errorDe(campo);
    return err ? <span className="error-campo" id={`error-${campo}`}>{err}</span> : null;
  };

  function cambiarFila(clave: number, k: keyof Omit<FilaEnvio, 'clave'>, v: string) {
    setFilas((fs) => fs.map((f) => (f.clave === clave ? { ...f, [k]: v } : f)));
  }
  function agregarFila() {
    const ultima = filas.at(-1);
    const fila = nuevaFila();
    if (ultima?.toneladas) fila.toneladas = ultima.toneladas; // lo habitual: camiones del mismo tamaño
    setFilas((fs) => [...fs, fila]);
    setTimeout(() => document.getElementById(`toneladas-${fila.clave}`)?.focus(), 0);
  }
  function quitarFila(clave: number) {
    setFilas((fs) => (fs.length > 1 ? fs.filter((f) => f.clave !== clave) : fs));
  }

  function alEnviar(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    setMensaje(null);
    const e = validar();
    setErrores(e);
    if (e.length) {
      setTocados(new Set(e.map((x) => x.campo)));
      setTimeout(() => resumen.current?.focus(), 0);
      return;
    }
    const enviar: DatosPedido = {
      cliente_id: datos.cliente_id,
      orden_compra: datos.orden_compra.trim() || null,
      producto: datos.producto.trim(),
      destino_id: datos.destino_id,
      incoterm: datos.incoterm,
      notas: datos.notas.trim() || null,
    };
    const lista: EnvioNuevo[] = filas.map((f) => ({ toneladas: numero(f.toneladas), entrega: f.entrega, carga: f.carga || null }));
    iniciar(async () => {
      const r = await guardarPedido(id, enviar, lista);
      if (r.ok) router.push(`/pedidos/${r.id}`);
      else setMensaje(r.mensaje);
    });
  }

  const visibles = errores.filter((x) => tocados.has(x.campo));
  const hito = datos.incoterm ? hitoPorIncoterm(datos.incoterm) : null;
  const otrosIncoterms = INCOTERMS.filter((i) => !INCOTERMS_FRECUENTES.includes(i));

  return (
    <form onSubmit={alEnviar} noValidate className="formulario-pedido">
      {mensaje && <div role="alert" className="mensaje-error">{mensaje}</div>}
      {visibles.length > 0 && (
        <div className="resumen-errores" ref={resumen} tabIndex={-1} role="alert" aria-labelledby="titulo-errores">
          <strong id="titulo-errores">Corrija {visibles.length === 1 ? 'este dato' : `estos ${visibles.length} datos`} para guardar:</strong>
          <ul>{visibles.map((x) => <li key={x.campo}><a href={`#${x.campo}`}>{x.mensaje}</a></li>)}</ul>
        </div>
      )}

      <fieldset>
        <legend>Datos del pedido</legend>
        <div className="rejilla">
          <label>Cliente <Req />
            <select {...props('cliente_id')} value={datos.cliente_id} onChange={(e) => setDatos({ ...datos, cliente_id: e.target.value })}>
              <option value="">Seleccione…</option>
              {clientes.map((c) => <option key={c.id} value={c.id}>{c.razon_social}</option>)}
            </select>
            {aviso('cliente_id')}
          </label>
          <label>Orden de compra del cliente
            <input {...props('orden_compra')} value={datos.orden_compra} maxLength={60} autoComplete="off"
              onChange={(e) => setDatos({ ...datos, orden_compra: e.target.value })} />
            <span className="ayuda-campo">Evita cargar dos veces el mismo pedido.</span>
          </label>
          <label>Producto <Req />
            <input {...props('producto')} value={datos.producto} maxLength={120}
              onChange={(e) => setDatos({ ...datos, producto: e.target.value })} />
            {aviso('producto')}
          </label>
          <label>Destino <Req />
            <select {...props('destino_id')} value={datos.destino_id} onChange={(e) => setDatos({ ...datos, destino_id: e.target.value })}>
              <option value="">Seleccione…</option>
              {ubicaciones.map((u) => <option key={u.id} value={u.id}>{u.nombre}{u.ciudad ? ` (${u.ciudad})` : ''} · {u.pais}</option>)}
            </select>
            {aviso('destino_id')}
          </label>
          <label>Incoterm <Req />
            <select {...props('incoterm')} value={datos.incoterm} onChange={(e) => setDatos({ ...datos, incoterm: e.target.value })}>
              <option value="">Seleccione…</option>
              <optgroup label="Los que usamos">{INCOTERMS_FRECUENTES.map((i) => <option key={i} value={i}>{i}</option>)}</optgroup>
              <optgroup label="Otros">{otrosIncoterms.map((i) => <option key={i} value={i}>{i}</option>)}</optgroup>
            </select>
            {aviso('incoterm') ?? (hito && <span className="ayuda-campo">El cumplimiento se mide {NOMBRE_HITO[hito]}.</span>)}
          </label>
        </div>
        <label>Notas
          <textarea name="notas" rows={2} value={datos.notas} onChange={(e) => setDatos({ ...datos, notas: e.target.value })} />
        </label>
      </fieldset>

      <fieldset>
        <legend>Programa de envíos</legend>
        <p className="ayuda" style={{ marginTop: 0 }}>Una fila por cada entrega parcial (normalmente un camión). La fecha de entrega es la que se promete al cliente.</p>
        <ol className="filas-envio">
          {filas.map((f, i) => (
            <li key={f.clave} className="fila-envio">
              <span className="numero-envio" aria-hidden="true">{i + 1}</span>
              <label>Toneladas <Req />
                <input {...props(`toneladas-${f.clave}`)} inputMode="decimal" value={f.toneladas} aria-label={`Toneladas del envío ${i + 1}`}
                  onChange={(e) => cambiarFila(f.clave, 'toneladas', e.target.value)} />
                {aviso(`toneladas-${f.clave}`)}
              </label>
              <label>Entrega <Req />
                <input {...props(`entrega-${f.clave}`)} type="date" value={f.entrega} aria-label={`Fecha de entrega del envío ${i + 1}`}
                  onChange={(e) => cambiarFila(f.clave, 'entrega', e.target.value)} />
                {aviso(`entrega-${f.clave}`)}
              </label>
              <label>Carga en fábrica
                <input {...props(`carga-${f.clave}`)} type="date" value={f.carga} aria-label={`Fecha de carga del envío ${i + 1}`}
                  onChange={(e) => cambiarFila(f.clave, 'carga', e.target.value)} />
                {aviso(`carga-${f.clave}`)}
              </label>
              <button type="button" className="boton-texto" onClick={() => quitarFila(f.clave)} disabled={filas.length === 1}
                aria-label={`Quitar el envío ${i + 1}`}>Quitar</button>
            </li>
          ))}
        </ol>
        <div className="pie-envios">
          <button type="button" className="boton secundario" onClick={agregarFila}>+ Agregar envío</button>
          <span role="status"><strong>Total: {formatoToneladas(total)}</strong> en {filas.length} {filas.length === 1 ? 'envío' : 'envíos'}</span>
        </div>
      </fieldset>

      <button className="boton" disabled={pendiente}>{pendiente ? 'Guardando…' : id ? 'Guardar cambios' : 'Guardar en borrador'}</button>
      <Link href={id ? `/pedidos/${id}` : '/pedidos'} className="enlace-cancelar">Cancelar</Link>
      <p className="ayuda">El pedido queda en borrador hasta que lo confirme. Al confirmarlo, las fechas de entrega pasan a ser el compromiso con el cliente.</p>
    </form>
  );
}
