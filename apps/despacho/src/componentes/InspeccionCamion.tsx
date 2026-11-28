import FormularioAccion from './FormularioAccion';
import FormularioInspeccion from './FormularioInspeccion';
import { Req } from './Obligatorio';
import {
  estadoCarga, horaCorta, PUNTOS_INSPECCION, TEXTO_ESTADO_CARGA, textoPunto, type CierreCarga, type Inspeccion,
} from '@/lib/inspeccion';
import { cerrarCarga, liberarCamion, registrarInspeccion } from '@/app/(panel)/almacen/acciones';

/**
 * «Inspección y cierre de carga» del camión del tramo 1: inspecciones con sus fotos, formulario
 * de inspección, «Cerrar carga» con precinto y la liberación por excepción del administrador.
 */
export default function InspeccionCamion({
  cierre, misionId, inspecciones, puedeCargar, esAdmin, obligatoria, abierto = false,
}: {
  cierre: CierreCarga;
  misionId: string;
  /** De la más reciente a la más antigua. */
  inspecciones: Inspeccion[];
  puedeCargar: boolean;
  esAdmin: boolean;
  obligatoria: boolean;
  abierto?: boolean;
}) {
  const estado = estadoCarga(cierre, inspecciones);
  const enFabrica = cierre.etapa === 'programado';
  const salioSinCierre = !enFabrica && cierre.etapa !== 'cancelado' && !cierre.fin_carga && !cierre.liberado_en;
  const puedeInspeccionar = puedeCargar && enFabrica && !cierre.fin_carga;
  const puedeCerrar = puedeCargar && cierre.etapa !== 'cancelado' && (estado === 'cargando' || estado === 'liberado' || estado === 'cerrada');

  return (
    <details className="carga-camion agregar inspeccion-camion" open={abierto || estado === 'rechazado'}>
      <summary>
        Inspección y cierre: <strong>{TEXTO_ESTADO_CARGA[estado]}</strong>
        {cierre.precinto && <> · precinto <strong>{cierre.precinto}</strong></>}
        {estado === 'rechazado' && <span className="etiqueta sin-peso">Rechazado</span>}
        {salioSinCierre && <span className="etiqueta sin-peso">Salió sin inspección</span>}
      </summary>

      {salioSinCierre && (
        <p className="alerta" role="alert">
          <strong>Este camión salió sin {inspecciones[0]?.resultado === 'aprobado' ? 'cerrar la carga con precinto' : 'inspección aprobada'}.</strong>{' '}
          Queda como alerta en el historial y en cumplimiento.
        </p>
      )}
      {cierre.liberado_en && (
        <p className="nota-estimado">Liberado por el administrador ({horaCorta(cierre.liberado_en)}): {cierre.liberado_motivo}</p>
      )}
      {(cierre.inicio_carga || cierre.fin_carga) && (
        <p>Inicio de carga <strong>{horaCorta(cierre.inicio_carga)}</strong> · fin de carga <strong>{horaCorta(cierre.fin_carga)}</strong></p>
      )}

      {inspecciones.length === 0 ? (
        <p className="nota-estimado">Aún no se inspeccionó este camión.</p>
      ) : (
        <ul className="lista-inspecciones">
          {inspecciones.map((i) => {
            const fallas = PUNTOS_INSPECCION.filter((p) => i.puntos?.[p.id] === false);
            return (
              <li key={i.id} className={i.resultado}>
                <strong>{i.resultado === 'aprobado' ? 'Aprobado' : 'Rechazado'}</strong> · {horaCorta(i.realizada_en)}
                {i.inspector_nombre && <> · {i.inspector_nombre}</>}
                {i.carga_anterior && <> · carga anterior: {i.carga_anterior}</>}
                {fallas.length > 0 && <div className="alerta">No cumple: {fallas.map((p) => textoPunto(p.id)).join(', ')}.</div>}
                {i.motivo && <div>Motivo: {i.motivo}</div>}
                {i.fotos.length > 0 && (
                  <div className="fotos-enlaces">
                    {i.fotos.map((_, n) => {
                      const url = i.enlaces?.[n];
                      return url
                        ? <a key={n} href={url} target="_blank" rel="noreferrer">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={url} alt={`Foto ${n + 1} de la inspección`} loading="lazy" />
                          </a>
                        : <span key={n}>Foto {n + 1}</span>;
                    })}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {puedeInspeccionar && estado !== 'cargando' && (
        <details className="agregar no-imprimir" open={abierto && estado !== 'liberado'}>
          <summary>{inspecciones.length ? 'Inspeccionar de nuevo' : 'Inspeccionar el camión'}</summary>
          <FormularioInspeccion asignacionId={cierre.id} misionId={misionId} registrar={registrarInspeccion} />
        </details>
      )}

      {puedeCerrar && (
        <details className="agregar no-imprimir" open={abierto && estado !== 'cerrada'}>
          <summary>{cierre.fin_carga ? 'Corregir precinto' : 'Cerrar carga'}</summary>
          <p className="ayuda">Cuando el camión ya está cargado y precintado. Registre antes los lotes y la balanza.</p>
          <FormularioAccion accion={cerrarCarga.bind(null, cierre.id, misionId)} boton={cierre.fin_carga ? 'Guardar precinto' : 'Cerrar carga'} cancelar>
            <label><span className="etiqueta-campo">N.º de precinto <Req /></span>
              <input name="precinto" required maxLength={60} autoComplete="off" defaultValue={cierre.precinto ?? ''} />
            </label>
          </FormularioAccion>
        </details>
      )}

      {esAdmin && enFabrica && !cierre.fin_carga && !cierre.liberado_en && (
        <details className="agregar no-imprimir">
          <summary>Liberar por excepción</summary>
          <p className="ayuda">
            {obligatoria
              ? 'El camión podrá cargar y salir sin inspección aprobada ni carga cerrada.'
              : 'Hoy el sistema está en modo alerta: el camión sale igual. Liberarlo evita la alerta y deja el motivo.'}
          </p>
          <FormularioAccion accion={liberarCamion.bind(null, cierre.id, misionId)} boton="Liberar camión" claseBoton="boton secundario" cancelar>
            <label><span className="etiqueta-campo">Motivo <Req /></span>
              <input name="motivo" required minLength={5} maxLength={300} placeholder="Ej. inspector ausente, revisado por el jefe de planta" />
            </label>
          </FormularioAccion>
        </details>
      )}
    </details>
  );
}
