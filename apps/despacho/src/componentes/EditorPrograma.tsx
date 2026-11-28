'use client';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition, type FormEvent } from 'react';
import { Req } from './Obligatorio';
import { confirmarPrograma, guardarPrograma, type EnvioNuevo } from '@/app/(panel)/pedidos/acciones';
import { dividirEnCamiones, formatoToneladas, plural, sumarDias, TOLERANCIA, TONELADAS_POR_CAMION } from '@/lib/pedidos';

interface Fila { clave: number; toneladas: string; entrega: string; carga: string }

/**
 * Envíos PLANIFICADOS del pedido (un envío por camión). Se cambian libremente hasta confirmar el programa.
 * «Dividir en camiones» arma las filas para lo que falta programar; después se ajustan una por una.
 */
export default function EditorPrograma({
  pedido, toneladasPedido, toneladasConfirmadas, numeroInicial, planificados, sugerirDesde, pedidoConfirmado,
}: {
  /** El programa solo se confirma cuando el pedido ya está confirmado. */
  pedidoConfirmado: boolean;
  pedido: string;
  toneladasPedido: number;
  /** Toneladas de envíos ya confirmados (no cancelados). */
  toneladasConfirmadas: number;
  /** Número que llevará el primer envío planificado. */
  numeroInicial: number;
  planificados: EnvioNuevo[];
  /** Fecha sugerida para la primera entrega al dividir. */
  sugerirDesde: string;
}) {
  const router = useRouter();
  const contador = useRef(0);
  const nueva = (e?: Partial<EnvioNuevo>): Fila => ({
    clave: ++contador.current, toneladas: e?.toneladas ? String(e.toneladas) : '', entrega: e?.entrega ?? '', carga: e?.carga ?? '',
  });
  const [filas, setFilas] = useState<Fila[]>(() => planificados.map(nueva));
  const [cambiado, setCambiado] = useState(false);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pendiente, iniciar] = useTransition();
  const [porCamion, setPorCamion] = useState(String(TONELADAS_POR_CAMION));
  const [desde, setDesde] = useState(sugerirDesde);
  const [cadaDias, setCadaDias] = useState('1');

  const numero = (t: string) => Number(t.replace(',', '.'));
  const planificadas = filas.reduce((s, f) => s + (numero(f.toneladas) > 0 ? numero(f.toneladas) : 0), 0);
  const programado = toneladasConfirmadas + planificadas;
  const falta = Math.round((toneladasPedido - programado) * 100) / 100;
  const excede = programado > toneladasPedido * (1 + TOLERANCIA) + 1e-9;
  const pct = (t: number) => `${Math.min(100, (t / toneladasPedido) * 100)}%`;

  function actualizar(fs: Fila[]) { setFilas(fs); setCambiado(true); setMensaje(null); }
  function dividir() {
    // Si ya hay envíos en el editor, los nuevos siguen después del último.
    const ultimaFila = filas.map((f) => f.entrega).filter(Boolean).sort().at(-1);
    const inicio = ultimaFila && ultimaFila >= desde ? sumarDias(ultimaFila, Math.max(1, Number(cadaDias) || 0)) : desde;
    const nuevas = dividirEnCamiones(Math.max(0, falta), numero(porCamion), inicio, Number(cadaDias) || 0);
    if (!nuevas.length) { setMensaje({ ok: false, texto: falta <= 0 ? 'Ya está programado todo el pedido.' : 'Indique las toneladas por camión y la primera entrega.' }); return; }
    actualizar([...filas, ...nuevas.map((e) => nueva(e))]);
  }

  function alGuardar(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const e: Record<string, string> = {};
    filas.forEach((f, i) => {
      const n = numeroInicial + i;
      if (!(numero(f.toneladas) > 0)) e[`t-${f.clave}`] = `Envío ${n}: toneladas mayores que 0.`;
      if (!f.entrega) e[`e-${f.clave}`] = `Envío ${n}: elija la fecha de entrega.`;
      if (f.carga && f.entrega && f.carga > f.entrega) e[`c-${f.clave}`] = `Envío ${n}: la carga no puede ser después de la entrega.`;
    });
    setErrores(e);
    if (Object.keys(e).length) {
      setMensaje({ ok: false, texto: `Corrija ${plural(Object.keys(e).length, 'dato', 'datos')} marcados en rojo.` });
      document.getElementById(Object.keys(e)[0]!)?.focus();
      return;
    }
    if (excede) { setMensaje({ ok: false, texto: `El programa (${formatoToneladas(programado)}) supera el pedido (${formatoToneladas(toneladasPedido)}) en más de 3 %.` }); return; }
    const lista = filas.map((f) => ({ toneladas: numero(f.toneladas), entrega: f.entrega, carga: f.carga || null }));
    iniciar(async () => {
      const r = await guardarPrograma(pedido, lista);
      setMensaje({ ok: r.ok, texto: r.mensaje });
      if (r.ok) { setCambiado(false); router.refresh(); }
    });
  }

  const campo = (clave: string, etiqueta: string) => ({
    id: clave, 'aria-label': etiqueta,
    'aria-invalid': errores[clave] ? true : undefined, 'aria-describedby': errores[clave] ? `error-${clave}` : undefined,
  });
  const aviso = (clave: string) => (errores[clave] ? <span className="error-campo" id={`error-${clave}`}>{errores[clave]}</span> : null);

  function confirmar() {
    iniciar(async () => {
      const r = await confirmarPrograma(pedido, null);
      setMensaje({ ok: r.ok, texto: r.mensaje });
      if (r.ok) { setFilas([]); router.refresh(); }
    });
  }

  return (
    <div className="editor-programa">
      <div className="avance-programa" role="group" aria-label="Avance del programa">
        <div className="barra-avance" aria-hidden="true">
          <span className="tramo confirmado" style={{ width: pct(toneladasConfirmadas) }} />
          <span className="tramo planificado" style={{ width: pct(Math.max(0, Math.min(planificadas, toneladasPedido - toneladasConfirmadas))) }} />
        </div>
        <p className="leyenda-avance">
          Pedido <strong>{formatoToneladas(toneladasPedido)}</strong>
          {' · '}<span className="muestra confirmado" aria-hidden="true" />Confirmado {formatoToneladas(toneladasConfirmadas)}
          {' · '}<span className="muestra planificado" aria-hidden="true" />Planificado {formatoToneladas(planificadas)}
          {' · '}{falta > 0
            ? <strong>Falta programar {formatoToneladas(falta)}</strong>
            : excede ? <strong className="docs-faltan">Sobran {formatoToneladas(-falta)}</strong> : <strong>Todo programado</strong>}
        </p>
      </div>

      {falta > 0 && (
        <details className="agregar dividir" open={filas.length === 0}>
          <summary>Dividir en camiones lo que falta ({formatoToneladas(falta)})</summary>
          <div className="rejilla">
            <label>Toneladas por camión<input inputMode="decimal" value={porCamion} onChange={(e) => setPorCamion(e.target.value)} /></label>
            <label>Primera entrega<input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
            <label>Un camión cada (días)<input inputMode="numeric" value={cadaDias} onChange={(e) => setCadaDias(e.target.value)} />
              <span className="ayuda-campo">0 = todos el mismo día.</span></label>
          </div>
          <button type="button" className="boton secundario" onClick={dividir}>
            Crear {plural(dividirEnCamiones(Math.max(0, falta), numero(porCamion), desde || '2000-01-01', 0).length, 'envío', 'envíos')}
          </button>
        </details>
      )}

      <form onSubmit={alGuardar} noValidate>
        {filas.length > 0 && (
          <ol className="filas-envio">
            {filas.map((f, i) => {
              const n = numeroInicial + i;
              return (
                <li key={f.clave} className="fila-envio">
                  <span className="numero-envio" aria-hidden="true">{n}</span>
                  <label>Toneladas <Req />
                    <input {...campo(`t-${f.clave}`, `Toneladas del envío ${n}`)} inputMode="decimal" value={f.toneladas}
                      onChange={(e) => actualizar(filas.map((x) => (x.clave === f.clave ? { ...x, toneladas: e.target.value } : x)))} />
                    {aviso(`t-${f.clave}`)}
                  </label>
                  <label>Entrega <Req />
                    <input {...campo(`e-${f.clave}`, `Fecha de entrega del envío ${n}`)} type="date" value={f.entrega}
                      onChange={(e) => actualizar(filas.map((x) => (x.clave === f.clave ? { ...x, entrega: e.target.value } : x)))} />
                    {aviso(`e-${f.clave}`)}
                  </label>
                  <label>Carga en fábrica
                    <input {...campo(`c-${f.clave}`, `Fecha de carga del envío ${n}`)} type="date" value={f.carga}
                      onChange={(e) => actualizar(filas.map((x) => (x.clave === f.clave ? { ...x, carga: e.target.value } : x)))} />
                    {aviso(`c-${f.clave}`)}
                  </label>
                  <button type="button" className="boton-texto" aria-label={`Quitar el envío ${n}`}
                    onClick={() => actualizar(filas.filter((x) => x.clave !== f.clave))}>Quitar</button>
                </li>
              );
            })}
          </ol>
        )}
        <div className="pie-envios">
          <button type="button" className="boton-texto verde" onClick={() => actualizar([...filas, nueva({ toneladas: Number(porCamion) || undefined })])}>
            + Agregar un envío
          </button>
        </div>
        {mensaje && <div role="status" className={mensaje.ok ? 'mensaje-ok' : 'mensaje-error'}>{mensaje.texto}</div>}
        <div className="botones-programa">
          {cambiado && <button className="boton" disabled={pendiente}>{pendiente ? 'Guardando…' : 'Guardar programa'}</button>}
          {!cambiado && filas.length > 0 && pedidoConfirmado && (
            <button type="button" className="boton dorado" disabled={pendiente} onClick={confirmar}>
              {pendiente ? 'Confirmando…' : `Confirmar programa (${plural(filas.length, 'envío', 'envíos')})`}
            </button>
          )}
        </div>
        {!cambiado && filas.length > 0 && (
          <p className="ayuda">
            {pedidoConfirmado
              ? 'Al confirmar el programa, cada fecha de entrega queda como compromiso con el cliente y solo se cambia con «Reprogramar» y su causa.'
              : 'El programa queda planificado. Se confirma después de confirmar el pedido.'}
          </p>
        )}
      </form>
    </div>
  );
}
