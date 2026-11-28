import FormularioAccion from './FormularioAccion';
import { ALCANCE_REQUISITO, CLAVES_REQUISITO, NOMBRE_MOMENTO, TIPO_DOCUMENTO, momentoDocumento } from '@/lib/documentos';
import { alternarRequisitoGeneral, guardarRequisitoGeneral, guardarRequisitosCliente } from '@/app/(panel)/catalogos/acciones';

export interface Requisito {
  documento: string;
  momento: string;
  alcance: 'todos' | 'internacional' | 'pais' | 'cliente';
  pais: string | null;
  cliente_id: string | null;
  requerido: boolean;
  activo: boolean;
}

const NOMBRE_PAIS: Record<string, string> = { BO: 'Bolivia', PE: 'Perú', CL: 'Chile' };
const textoAlcance = (r: Requisito) => (r.alcance === 'pais' ? `Destino ${NOMBRE_PAIS[r.pais ?? ''] ?? r.pais}` : ALCANCE_REQUISITO[r.alcance]);

/** Reglas generales que se le aplican al cliente (por su país, como referencia). */
function generalesPara(generales: Requisito[], clave: string) {
  return generales.filter((r) => r.activo && r.documento === clave);
}

/** «Documentos que exige este cliente»: por documento, regla general, exige o no requerido. */
export function RequisitosCliente({ clienteId, requisitos, generales, puedeEditar }: {
  clienteId: string;
  requisitos: Requisito[];
  generales: Requisito[];
  puedeEditar: boolean;
}) {
  const estado = (clave: string) => {
    const r = requisitos.find((x) => x.documento === clave);
    return r ? (r.requerido ? 'exige' : 'no_requerido') : '';
  };
  const clave = requisitos.map((r) => `${r.documento}:${r.requerido}`).sort().join('|');
  return (
    <section className="requisitos-cliente">
      <h3>Documentos que exige este cliente</h3>
      <p className="ayuda">
        Lo que elija aquí se suma a las reglas generales (factura siempre, DEX fuera de Bolivia, CRT y MIC/DTA en el transbordo,
        guía firmada en la entrega). Use «No lo requiere» para quitar una regla general solo para este cliente.
      </p>
      <FormularioAccion key={clave} accion={guardarRequisitosCliente.bind(null, clienteId)} boton="Guardar documentos" claseBoton="boton secundario">
        <div className="tabla-desplazable"><table className="tabla-requisitos">
          <thead><tr><th>Documento</th><th>Cuándo</th><th>Regla general</th><th>Este cliente</th></tr></thead>
          <tbody>
            {CLAVES_REQUISITO.map((c) => {
              const g = generalesPara(generales, c);
              return (
                <tr key={c}>
                  <td data-etiqueta="Documento">{TIPO_DOCUMENTO[c]}</td>
                  <td data-etiqueta="Cuándo">{NOMBRE_MOMENTO[momentoDocumento(c)]}</td>
                  <td data-etiqueta="Regla general">{g.length ? g.map(textoAlcance).join(', ') : <span className="vacio">No se exige</span>}</td>
                  <td data-etiqueta="Este cliente">
                    <select name={`req_${c}`} defaultValue={estado(c)} disabled={!puedeEditar} aria-label={`${TIPO_DOCUMENTO[c]} para este cliente`}>
                      <option value="">Según la regla general</option>
                      <option value="exige">Lo exige</option>
                      <option value="no_requerido">No lo requiere</option>
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </FormularioAccion>
    </section>
  );
}

/** ADMINISTRADOR: reglas generales de documentos (todos, fuera de Bolivia o por país). */
export function ReglasGenerales({ generales }: { generales: Requisito[] }) {
  return (
    <details className="agregar requisitos-generales">
      <summary>Reglas generales de documentos ({generales.filter((r) => r.activo).length} activas)</summary>
      <p className="ayuda">Valen para todos los clientes. Cada cliente puede agregar documentos o marcar uno como «No lo requiere».</p>
      <div className="tabla-desplazable"><table className="tabla-requisitos">
        <thead><tr><th>Documento</th><th>Cuándo</th><th>Se exige a</th><th>Estado</th><th><span className="solo-lector">Acción</span></th></tr></thead>
        <tbody>
          {generales.map((r) => (
            <tr key={`${r.documento}-${r.alcance}-${r.pais ?? ''}`} className={r.activo ? undefined : 'inactivo'}>
              <td data-etiqueta="Documento">{TIPO_DOCUMENTO[r.documento] ?? r.documento}</td>
              <td data-etiqueta="Cuándo">{NOMBRE_MOMENTO[r.momento as keyof typeof NOMBRE_MOMENTO] ?? r.momento}</td>
              <td data-etiqueta="Se exige a">{textoAlcance(r)}</td>
              <td data-etiqueta="Estado">{r.activo ? 'Activa' : 'Inactiva'}</td>
              <td className="acciones">
                <form action={alternarRequisitoGeneral.bind(null, r.documento, r.alcance, r.pais, !r.activo)} style={{ display: 'inline' }}>
                  <button className="enlace-boton">{r.activo ? 'Desactivar' : 'Activar'}</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <h4>Agregar regla</h4>
      <FormularioAccion accion={guardarRequisitoGeneral} boton="Agregar regla" claseBoton="boton secundario">
        <div className="rejilla">
          <label>Documento
            <select name="documento" required defaultValue="">
              <option value="" disabled>Elija…</option>
              {CLAVES_REQUISITO.map((c) => <option key={c} value={c}>{TIPO_DOCUMENTO[c]}</option>)}
            </select>
          </label>
          <label>Se exige a
            <select name="alcance" defaultValue="pais">
              <option value="todos">Todos los envíos</option>
              <option value="internacional">Envíos fuera de Bolivia</option>
              <option value="pais">Un país de destino</option>
            </select>
          </label>
          <label>País (si eligió un país)
            <select name="pais" defaultValue="PE">
              <option value="PE">Perú</option><option value="CL">Chile</option><option value="BO">Bolivia</option>
            </select>
          </label>
        </div>
      </FormularioAccion>
    </details>
  );
}
