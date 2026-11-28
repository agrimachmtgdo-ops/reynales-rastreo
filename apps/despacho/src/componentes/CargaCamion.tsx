import FormularioAccion from './FormularioAccion';
import SelectorProducto from './SelectorProducto';
import { Req } from './Obligatorio';
import type { Producto } from '@/lib/productos';
import {
  cantidadLote, compararLotesBalanza, formatoKg, nombrePresentacion, PRESENTACIONES, presentacionSugerida, salioSinLotes,
  type LoteCamion,
} from '@/lib/lotes';
import { guardarLote, quitarLote, registrarBalanza } from '@/app/(panel)/misiones/acciones';

interface CamionCarga {
  id: string;
  etapa: string;
  tramo?: number;
  toneladas_cargadas: number | null;
  kg_lotes?: number | null;
  ticket_balanza?: string | null;
  peso_bruto_kg?: number | null;
  tara_kg?: number | null;
}

/**
 * «Carga del camión» (tramo 1): ticket de balanza y lotes de producción que lleva.
 * Solo administrador y logística ven los formularios; los demás perfiles ven los datos.
 */
export default function CargaCamion({
  camion, misionId, lotes, productos, productoMision, puedeEditar, tolerancia,
}: {
  camion: CamionCarga;
  misionId: string;
  lotes: LoteCamion[];
  productos: Producto[];
  productoMision: string | null;
  puedeEditar: boolean;
  tolerancia: number;
}) {
  const comparacion = compararLotesBalanza(camion.kg_lotes, camion.toneladas_cargadas, tolerancia);
  const sinLotes = salioSinLotes(camion);
  const productoBase = productos.find((p) => p.id === productoMision) ?? null;
  const sugerida = presentacionSugerida(productoBase?.presentacion) ?? 'saco_50';
  const resumen = [
    lotes.length === 0 ? 'sin lotes' : lotes.length === 1 ? '1 lote' : `${lotes.length} lotes`,
    camion.ticket_balanza ? `ticket ${camion.ticket_balanza}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <details className="carga-camion agregar" open={comparacion?.fuera ?? false}>
      <summary>
        Carga del camión: <strong>{resumen}</strong>
        {sinLotes && <span className="etiqueta sin-peso">Sin lotes</span>}
        {comparacion?.fuera && <span className="etiqueta sin-peso">Lotes ≠ balanza</span>}
      </summary>

      {sinLotes && (
        <p className="alerta" role="alert">
          <strong>Salió sin lotes registrados.</strong> Anote los lotes que lleva para poder rastrearlos ante un reclamo.
        </p>
      )}

      <h5>Balanza</h5>
      <p>
        {camion.peso_bruto_kg != null && camion.tara_kg != null
          ? <>Bruto <strong>{formatoKg(Number(camion.peso_bruto_kg))}</strong> − tara <strong>{formatoKg(Number(camion.tara_kg))}</strong> = neto </>
          : 'Neto '}
        <strong>{camion.toneladas_cargadas != null ? `${Number(camion.toneladas_cargadas).toLocaleString('es-BO', { maximumFractionDigits: 2 })} t` : 'sin registrar'}</strong>
        {camion.ticket_balanza && <> · ticket <strong>{camion.ticket_balanza}</strong></>}
      </p>
      {puedeEditar && camion.etapa !== 'cancelado' && (
        <details className="agregar no-imprimir">
          <summary>{camion.toneladas_cargadas != null ? 'Corregir balanza' : 'Registrar balanza'}</summary>
          <FormularioAccion accion={registrarBalanza.bind(null, camion.id, misionId)} boton="Guardar balanza" claseBoton="boton secundario" cancelar>
            <div className="rejilla">
              <label><span className="etiqueta-campo">N.º de ticket</span>
                <input name="ticket_balanza" defaultValue={camion.ticket_balanza ?? ''} maxLength={40} autoComplete="off" />
              </label>
              <label><span className="etiqueta-campo">Peso bruto (kg)</span>
                <input name="peso_bruto_kg" inputMode="decimal" defaultValue={camion.peso_bruto_kg ?? ''} placeholder="45650" />
              </label>
              <label><span className="etiqueta-campo">Tara (kg)</span>
                <input name="tara_kg" inputMode="decimal" defaultValue={camion.tara_kg ?? ''} placeholder="16050" />
              </label>
              <label><span className="etiqueta-campo">o solo neto (t)</span>
                <input name="neto_t" inputMode="decimal" placeholder="29,6" />
                <span className="ayuda-campo">Si escribe bruto y tara, el neto se calcula solo.</span>
              </label>
            </div>
          </FormularioAccion>
        </details>
      )}

      <h5>Lotes</h5>
      {lotes.length === 0 ? (
        <p className="nota-estimado">Aún no hay lotes registrados en este camión.</p>
      ) : (
        <div className="tabla-desplazable"><table className="tabla-lotes">
          <thead>
            <tr><th>Lote</th><th>Producto</th><th>Producción</th><th>Cantidad</th>{puedeEditar && <th><span className="solo-lector">Acciones</span></th>}</tr>
          </thead>
          <tbody>
            {lotes.map((l) => (
              <tr key={l.id}>
                <td data-etiqueta="Lote"><strong>{l.lote}</strong></td>
                <td data-etiqueta="Producto">{l.producto?.nombre ?? '—'} · {nombrePresentacion(l.presentacion)}</td>
                <td data-etiqueta="Producción">{l.fecha_produccion ? new Date(`${l.fecha_produccion}T12:00:00`).toLocaleDateString('es-BO') : '—'}</td>
                <td data-etiqueta="Cantidad">{cantidadLote(l)}</td>
                {puedeEditar && (
                  <td>
                    <FormularioAccion accion={quitarLote.bind(null, l.id, misionId)} boton="Quitar" claseBoton="boton boton-chico secundario">
                      <></>
                    </FormularioAccion>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}>Total de lotes</td>
              <td colSpan={puedeEditar ? 2 : 1}>
                <strong>{formatoKg(Number(camion.kg_lotes ?? 0))}</strong>
                {comparacion && (
                  <span className={comparacion.fuera ? 'alerta' : 'nota-estimado'}>
                    {' '}({comparacion.difKg >= 0 ? '+' : '−'}{formatoKg(Math.abs(comparacion.difKg))} frente a la balanza, {comparacion.pct.toFixed(1)} %
                    {comparacion.fuera ? `: supera el ${tolerancia.toLocaleString('es-BO')} % permitido` : ''})
                  </span>
                )}
              </td>
            </tr>
          </tfoot>
        </table></div>
      )}

      {puedeEditar && camion.etapa !== 'cancelado' && (
        <details className="agregar no-imprimir" open={lotes.length === 0 && camion.etapa === 'programado'}>
          <summary>Agregar lote</summary>
          <FormularioAccion accion={guardarLote.bind(null, camion.id, misionId, null)} boton="Agregar lote" claseBoton="boton secundario" cancelar>
            <div className="rejilla">
              <SelectorProducto productos={productos} actualId={productoMision} obligatorio />
              <label><span className="etiqueta-campo">N.º de lote <Req /></span>
                <input name="lote" required maxLength={40} autoComplete="off" placeholder="L-2611A" pattern="[A-Za-z0-9./\- ]{1,40}" />
              </label>
              <label><span className="etiqueta-campo">Fecha de producción</span>
                <input name="fecha_produccion" type="date" />
              </label>
              <label><span className="etiqueta-campo">Presentación <Req /></span>
                <select name="presentacion" required defaultValue={sugerida}>
                  {PRESENTACIONES.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              </label>
              <label><span className="etiqueta-campo">Sacos o big bags</span>
                <input name="unidades" inputMode="numeric" placeholder="400" />
                <span className="ayuda-campo">Los kg se calculan con el peso de cada unidad.</span>
              </label>
              <label><span className="etiqueta-campo">Kg (solo granel)</span>
                <input name="kg" inputMode="decimal" placeholder="12500" />
              </label>
            </div>
          </FormularioAccion>
        </details>
      )}
    </details>
  );
}
