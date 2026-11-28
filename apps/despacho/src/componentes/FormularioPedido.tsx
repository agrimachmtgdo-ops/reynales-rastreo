'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition, type FormEvent } from 'react';
import { Req } from './Obligatorio';
import { guardarPedido, type DatosPedido } from '@/app/(panel)/pedidos/acciones';
import { hitoPorIncoterm, INCOTERMS, NOMBRE_HITO, plural, TONELADAS_POR_CAMION } from '@/lib/pedidos';

export interface OpcionCliente { id: string; razon_social: string }
export interface OpcionUbicacion { id: string; nombre: string; ciudad: string | null; pais: string }
interface ErrorForm { campo: string; mensaje: string }

const INCOTERMS_FRECUENTES = ['CPT', 'FCA', 'FOB'];
type Campos = 'cliente_id' | 'orden_compra' | 'producto' | 'toneladas' | 'entrega_desde' | 'entrega_hasta' | 'destino_id' | 'incoterm' | 'notas';

/**
 * Formulario del PEDIDO: lo que el cliente compra (cantidad total y plazo). El programa de envíos
 * (un envío por camión) se arma después, en el detalle del pedido.
 * Valida al salir de cada campo y, al guardar, muestra un resumen de errores con enlaces a cada campo.
 */
export default function FormularioPedido({
  id, clientes, ubicaciones, inicial,
}: {
  id: string | null;
  clientes: OpcionCliente[];
  ubicaciones: OpcionUbicacion[];
  inicial?: Partial<DatosPedido>;
}) {
  const router = useRouter();
  const [datos, setDatos] = useState<Record<Campos, string>>({
    cliente_id: inicial?.cliente_id ?? '',
    orden_compra: inicial?.orden_compra ?? '',
    producto: inicial?.producto ?? '',
    toneladas: inicial?.toneladas != null ? String(inicial.toneladas) : '',
    entrega_desde: inicial?.entrega_desde ?? '',
    entrega_hasta: inicial?.entrega_hasta ?? '',
    destino_id: inicial?.destino_id ?? '',
    incoterm: inicial?.incoterm ?? '',
    notas: inicial?.notas ?? '',
  });
  const [errores, setErrores] = useState<ErrorForm[]>([]);
  const [tocados, setTocados] = useState<Set<string>>(new Set());
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();
  const resumen = useRef<HTMLDivElement>(null);

  const toneladas = Number(datos.toneladas.replace(',', '.'));
  const camiones = toneladas > 0 ? Math.max(1, Math.ceil(toneladas / (TONELADAS_POR_CAMION * 1.05))) : 0;

  function validar(d = datos): ErrorForm[] {
    const e: ErrorForm[] = [];
    const t = Number(d.toneladas.replace(',', '.'));
    if (!d.cliente_id) e.push({ campo: 'cliente_id', mensaje: 'Elija el cliente.' });
    if (!d.producto.trim()) e.push({ campo: 'producto', mensaje: 'Escriba el producto.' });
    if (!(t > 0)) e.push({ campo: 'toneladas', mensaje: 'Escriba las toneladas que pidió el cliente (mayor que 0).' });
    if (!d.entrega_hasta) e.push({ campo: 'entrega_hasta', mensaje: 'Elija la fecha límite de entrega.' });
    if (d.entrega_desde && d.entrega_hasta && d.entrega_desde > d.entrega_hasta) {
      e.push({ campo: 'entrega_desde', mensaje: 'La fecha «desde» no puede ser posterior a la fecha límite.' });
    }
    if (!d.destino_id) e.push({ campo: 'destino_id', mensaje: 'Elija el destino.' });
    if (!d.incoterm) e.push({ campo: 'incoterm', mensaje: 'Elija el Incoterm.' });
    return e;
  }
  const cambiar = (k: Campos, v: string) => {
    const d = { ...datos, [k]: v };
    setDatos(d);
    if (tocados.has(k)) setErrores(validar(d));
  };
  const errorDe = (campo: string) => (tocados.has(campo) ? errores.find((x) => x.campo === campo)?.mensaje : undefined);
  const props = (campo: Campos) => {
    const err = errorDe(campo);
    return {
      id: campo, name: campo, value: datos[campo],
      onBlur: () => { setTocados((t) => new Set(t).add(campo)); setErrores(validar()); },
      'aria-invalid': err ? true : undefined, 'aria-describedby': err ? `error-${campo}` : undefined,
    };
  };
  const aviso = (campo: string) => {
    const err = errorDe(campo);
    return err ? <span className="error-campo" id={`error-${campo}`}>{err}</span> : null;
  };

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
      toneladas,
      entrega_desde: datos.entrega_desde || null,
      entrega_hasta: datos.entrega_hasta,
      destino_id: datos.destino_id,
      incoterm: datos.incoterm,
      notas: datos.notas.trim() || null,
    };
    iniciar(async () => {
      const r = await guardarPedido(id, enviar);
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
        <legend>Qué pidió el cliente</legend>
        <div className="rejilla">
          <label>Cliente <Req />
            <select {...props('cliente_id')} onChange={(e) => cambiar('cliente_id', e.target.value)}>
              <option value="">Seleccione…</option>
              {clientes.map((c) => <option key={c.id} value={c.id}>{c.razon_social}</option>)}
            </select>
            {aviso('cliente_id')}
          </label>
          <label>Orden de compra del cliente
            <input {...props('orden_compra')} maxLength={60} autoComplete="off" onChange={(e) => cambiar('orden_compra', e.target.value)} />
            <span className="ayuda-campo">Evita cargar dos veces el mismo pedido.</span>
          </label>
          <label>Producto <Req />
            <input {...props('producto')} maxLength={120} onChange={(e) => cambiar('producto', e.target.value)} />
            {aviso('producto')}
          </label>
          <label>Toneladas pedidas <Req />
            <input {...props('toneladas')} inputMode="decimal" onChange={(e) => cambiar('toneladas', e.target.value)} />
            {aviso('toneladas') ?? (camiones > 0 && (
              <span className="ayuda-campo">Son unos {plural(camiones, 'camión', 'camiones')} de {TONELADAS_POR_CAMION} t. Los envíos se programan después.</span>
            ))}
          </label>
        </div>
      </fieldset>

      <fieldset>
        <legend>Dónde y cuándo</legend>
        <div className="rejilla">
          <label>Destino <Req />
            <select {...props('destino_id')} onChange={(e) => cambiar('destino_id', e.target.value)}>
              <option value="">Seleccione…</option>
              {ubicaciones.map((u) => <option key={u.id} value={u.id}>{u.nombre}{u.ciudad ? ` (${u.ciudad})` : ''} · {u.pais}</option>)}
            </select>
            {aviso('destino_id')}
          </label>
          <label>Incoterm <Req />
            <select {...props('incoterm')} onChange={(e) => cambiar('incoterm', e.target.value)}>
              <option value="">Seleccione…</option>
              <optgroup label="Los que usamos">{INCOTERMS_FRECUENTES.map((i) => <option key={i} value={i}>{i}</option>)}</optgroup>
              <optgroup label="Otros">{otrosIncoterms.map((i) => <option key={i} value={i}>{i}</option>)}</optgroup>
            </select>
            {aviso('incoterm') ?? (hito && <span className="ayuda-campo">El cumplimiento se mide {NOMBRE_HITO[hito]}.</span>)}
          </label>
          <label>Entregar desde
            <input {...props('entrega_desde')} type="date" onChange={(e) => cambiar('entrega_desde', e.target.value)} />
            {aviso('entrega_desde') ?? <span className="ayuda-campo">Opcional: si el cliente no recibe antes de esa fecha.</span>}
          </label>
          <label>Fecha límite de entrega <Req />
            <input {...props('entrega_hasta')} type="date" onChange={(e) => cambiar('entrega_hasta', e.target.value)} />
            {aviso('entrega_hasta') ?? <span className="ayuda-campo">Hasta cuándo debe estar entregado todo el pedido.</span>}
          </label>
        </div>
        <label>Notas
          <textarea {...props('notas')} rows={2} onChange={(e) => cambiar('notas', e.target.value)} />
        </label>
      </fieldset>

      <button className="boton" disabled={pendiente}>{pendiente ? 'Guardando…' : id ? 'Guardar cambios' : 'Guardar pedido'}</button>
      <Link href={id ? `/pedidos/${id}` : '/pedidos'} className="enlace-cancelar">Cancelar</Link>
      <p className="ayuda">Al guardar, el pedido queda en borrador y se abre su ficha para armar el programa de envíos (un envío por camión).</p>
    </form>
  );
}
