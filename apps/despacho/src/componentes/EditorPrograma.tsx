'use client';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition, type FormEvent } from 'react';
import { Req } from './Obligatorio';
import { confirmarPrograma, guardarPrograma, type EnvioNuevo } from '@/app/(panel)/pedidos/acciones';
import { dividirEnCamiones, formatoToneladas, plural, sumarDias, TOLERANCIA, TONELADAS_POR_CAMION } from '@/lib/pedidos';

interface Fila { clave: number; toneladas: string; entrega: string; carga: string }

/**
 * Envíos PLANIFICADOS del pedido. Un envío es un lote que se entrega en una fecha y puede llevar varios
 * camiones. Se cambian libremente hasta confirmar el programa.
 * «Repartir en envíos» arma las filas para lo que falta programar; después se ajustan una por una.
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
  const [porEnvio, setPorEnvio] = useState(String(TONELADAS_POR_CAMION * 5));
  const [desde, setDesde] = useState(sugerirDesde);
  const [cadaDias, setCadaDias] = useState('7');

  const numero = (t: string) => Number(t.replace(',', '.'));
  const planificadas = filas.reduce((s, f) => s + (numero(f.toneladas) > 0 ? numero(f.toneladas) : 0), 0);
  const programado = toneladasConfirmadas + planificadas;
  const falta = Math.round((toneladasPedido - programado) * 100) / 100;
  const excede = programado > toneladasPedido * (1 + TOLERANCIA) + 1e-9;
  const pct = (t: number) => `${Math.min(100, (t / toneladasPedido) * 100)}%`;

  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/La_Paz' });
  const camionesDe = (t: number) => Math.max(1, Math.ceil(t / (TONELADAS_POR_CAMION * 1.05)));
  /** Avisos que no impiden guardar: fechas pasadas o una carga muy anticipada (posible error de mes). */
  function avisosDe(f: Fila): string | null {
    if (f.entrega && f.entrega < hoy) return 'La fecha de entrega ya pasó.';
    if (f.carga && f.carga < hoy) return 'La fecha de carga ya pasó. ¿Es el mes correcto?';
    if (f.carga && f.entrega) {
      const dias = Math.round((Date.parse(f.entrega) - Date.parse(f.carga)) / 86_400_000);
      if (dias > 15) return `La carga es ${dias} días antes de la entrega. ¿Es el mes correcto?`;
    }
    return null;
  }
  const conAviso = filas.filter((f) => avisosDe(f)).length;
  const [avisoVisto, setAvisoVisto] = useState(false);

  function actualizar(fs: Fila[]) { setFilas(fs); setCambiado(true); setMensaje(null); setAvisoVisto(false); }
  function dividir() {
    // Si ya hay envíos en el editor, los nuevos siguen después del último.
    const ultimaFila = filas.map((f) => f.entrega).filter(Boolean).sort().at(-1);
    const inicio = ultimaFila && ultimaFila >= desde ? sumarDias(ultimaFila, Math.max(1, Number(cadaDias) || 0)) : desde;
    const nuevas = dividirEnCamiones(Math.max(0, falta), numero(porEnvio), inicio, Number(cadaDias) || 0);
    if (!nuevas.length) { setMensaje({ ok: false, texto: falta <= 0 ? 'Ya está programado todo el pedido.' : 'Indique las toneladas por envío y la primera entrega.' }); return; }
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
    if (conAviso && !avisoVisto) {
      setAvisoVisto(true);
      setMensaje({ ok: false, texto: `Revise ${plural(conAviso, 'envío marcado', 'envíos marcados')} en amarillo. Si está bien así, pulse «Guardar programa» otra vez.` });
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
        <ul className="leyenda-avance">
          <li><span className="muestra confirmado" aria-hidden="true" />Confirmado {formatoToneladas(toneladasConfirmadas)}</li>
          <li><span className="muestra planificado" aria-hidden="true" />Planificado {formatoToneladas(planificadas)}</li>
          <li><span className="muestra muestra-faltan" aria-hidden="true" />de {formatoToneladas(toneladasPedido)} pedidas</li>
          <li className="estado-programa">{falta > 0
            ? <strong>Falta programar {formatoToneladas(falta)}</strong>
            : excede ? <strong className="docs-faltan">Sobran {formatoToneladas(-falta)}</strong> : <strong className="todo-programado">✓ Todo programado</strong>}</li>
        </ul>
      </div>

      {falta > 0 && (
        <details className="agregar dividir" open={filas.length === 0}>
          <summary>Repartir en envíos lo que falta ({formatoToneladas(falta)})</summary>
          <div className="rejilla">
            <label>Toneladas por envío<input inputMode="decimal" value={porEnvio} onChange={(e) => setPorEnvio(e.target.value)} />
              {numero(porEnvio) > 0 && <span className="ayuda-campo">≈ {plural(camionesDe(numero(porEnvio)), 'camión', 'camiones')} de {TONELADAS_POR_CAMION} t por envío.</span>}</label>
            <label>Primera entrega<input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
            <label>Un envío cada (días)<input inputMode="numeric" value={cadaDias} onChange={(e) => setCadaDias(e.target.value)} />
              <span className="ayuda-campo">0 = todos el mismo día.</span></label>
          </div>
          <button type="button" className="boton secundario" onClick={dividir}>
            Crear {plural(dividirEnCamiones(Math.max(0, falta), numero(porEnvio), desde || '2000-01-01', 0).length, 'envío', 'envíos')}
          </button>
        </details>
      )}

      <form onSubmit={alGuardar} noValidate>
        {filas.length > 0 && (
          <ol className="filas-envio">
            {filas.map((f, i) => {
              const n = numeroInicial + i;
              const alerta = avisosDe(f);
              const t = numero(f.toneladas);
              return (
                <li key={f.clave} className={alerta ? 'fila-envio con-aviso' : 'fila-envio'}>
                  <span className="numero-envio" aria-hidden="true">{n}</span>
                  <label>Toneladas <Req />
                    <input {...campo(`t-${f.clave}`, `Toneladas del envío ${n}`)} inputMode="decimal" value={f.toneladas}
                      onChange={(e) => actualizar(filas.map((x) => (x.clave === f.clave ? { ...x, toneladas: e.target.value } : x)))} />
                    {aviso(`t-${f.clave}`) ?? (t > 0 && <span className="ayuda-campo">≈ {plural(camionesDe(t), 'camión', 'camiones')}</span>)}
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
                  {alerta && <p className="aviso-fila" role="status">⚠ Envío {n}: {alerta}</p>}
                </li>
              );
            })}
          </ol>
        )}
        <div className="pie-envios">
          <button type="button" className="boton-texto verde" onClick={() => actualizar([...filas, nueva({ toneladas: numero(porEnvio) || undefined })])}>
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
