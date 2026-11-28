import { Req } from './Obligatorio';

/** Presentaciones habituales de Reynales; «Otra» permite escribir una distinta. */
export const PRESENTACIONES = ['Sacos de 50 kg', 'Sacos de 40 kg', 'Big bag de 1.200 kg', 'Granel'];
/** Valor del botón «Otra»: la acción toma entonces el texto de presentacion_otra. */
export const OTRA = '__otra';

type Fila = Record<string, unknown> & { id: string };
const v = (f: Fila | undefined, k: string) => (f?.[k] == null ? undefined : String(f[k]));

/** Campos del producto en dos secciones (Identificación; Presentación y aduana). Sirve para agregar y editar. */
export default function CamposProducto({ f }: { f?: Fila }) {
  const pres = v(f, 'presentacion');
  const otra = pres && !PRESENTACIONES.includes(pres) ? pres : undefined;
  const sufijo = f ? `-${f.id}` : '';
  return (
    <>
      <fieldset className="seccion-form" aria-labelledby={`sec-ident${sufijo}`}>
        <div className="seccion-titulo">
          <legend id={`sec-ident${sufijo}`}>Identificación</legend>
          <p>Cómo aparece el producto en pedidos, misiones y reportes.</p>
        </div>
        <div className="seccion-campos rejilla rejilla-2">
          <label><span className="etiqueta-campo">Nombre <Req /></span>
            <input name="nombre" required maxLength={120} placeholder="Ej. Harina Integral 50 kg" defaultValue={v(f, 'nombre')} aria-describedby={`ayuda-nombre${sufijo}`} />
            <span className="ayuda-campo" id={`ayuda-nombre${sufijo}`}>Si el producto se vende en varias presentaciones, registre una por cada una con su propio nombre.</span>
          </label>
          <label><span className="etiqueta-campo">Código interno</span>
            <input name="codigo" maxLength={30} placeholder="Ej. HI-50" autoComplete="off" defaultValue={v(f, 'codigo')} aria-describedby={`ayuda-codigo${sufijo}`} />
            <span className="ayuda-campo" id={`ayuda-codigo${sufijo}`}>Opcional: el código de la planta o de ventas. También sirve para importar pedidos desde Excel.</span>
          </label>
        </div>
      </fieldset>
      <fieldset className="seccion-form" aria-labelledby={`sec-pres${sufijo}`}>
        <div className="seccion-titulo">
          <legend id={`sec-pres${sufijo}`}>Presentación y aduana</legend>
          <p>Cómo se despacha y con qué partida se declara al exportar.</p>
        </div>
        <div className="seccion-campos">
          <div className="grupo-pastillas" role="radiogroup" aria-labelledby={`et-pres${sufijo}`}>
            <span className="etiqueta-campo" id={`et-pres${sufijo}`}>Presentación</span>
            <div className="pastillas">
              {PRESENTACIONES.map((p) => (
                <label key={p} className="pastilla">
                  <input type="radio" name="presentacion" value={p} defaultChecked={pres === p} /><span>{p}</span>
                </label>
              ))}
              <label className="pastilla">
                <input type="radio" name="presentacion" value={OTRA} defaultChecked={!!otra} /><span>Otra</span>
              </label>
            </div>
            <input name="presentacion_otra" className="campo-otra" maxLength={60} aria-label="Otra presentación"
              placeholder="Otra presentación (ej. Sacos de 25 kg)" defaultValue={otra} />
          </div>
          <label className="campo-partida"><span className="etiqueta-campo">Partida arancelaria (NANDINA)</span>
            <input name="partida_arancelaria" inputMode="decimal" maxLength={14} placeholder="Ej. 1101.00.00" pattern="[0-9.]{4,14}" defaultValue={v(f, 'partida_arancelaria')} aria-describedby={`ayuda-partida${sufijo}`} />
            <span className="ayuda-campo" id={`ayuda-partida${sufijo}`}>Opcional: solo números y puntos. Se usa en el DEX y en la factura de exportación.</span>
          </label>
        </div>
      </fieldset>
    </>
  );
}
