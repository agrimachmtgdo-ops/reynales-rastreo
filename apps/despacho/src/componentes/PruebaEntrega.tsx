import FormularioAccion from './FormularioAccion';
import { Req } from './Obligatorio';
import { diferenciaKg, KG_UNIDAD, NOVEDAD, textoCantidad, type Novedad, type PruebaEntrega as TPrueba } from '@/lib/entrega';
import { registrarEntrega } from '@/app/(panel)/misiones/acciones';

const hora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('es-BO', { timeZone: 'America/La_Paz', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
const miles = (n: number) => n.toLocaleString('es-BO', { maximumFractionDigits: 1 });

/**
 * «Prueba de entrega» de un camión del último tramo ya entregado: quién recibió, cuánto,
 * novedad, foto de la guía y fotos de la novedad. Si no hay prueba (o la registró logística),
 * logística puede registrarla o corregirla.
 */
export default function PruebaEntrega({
  prueba, asignacionId, misionId, puedeEditar, presentacion, unidadesSalida, kgSalida, tolerancia,
}: {
  prueba: TPrueba | null;
  asignacionId: string;
  misionId: string;
  puedeEditar: boolean;
  /** Lo que salió (para el formulario de logística). */
  presentacion: string | null;
  unidadesSalida: number | null;
  kgSalida: number | null;
  tolerancia: number;
}) {
  const dif = prueba ? diferenciaKg(prueba) : null;
  const falta = prueba && dif != null && prueba.kg_despachados != null && dif < -(Number(prueba.kg_despachados) * tolerancia) / 100;
  const conNovedad = prueba && (prueba.novedad !== 'sin_novedad' || falta);
  const fotosPendientes = prueba
    ? [prueba.foto_guia, ...(prueba.fotos_novedad ?? [])].filter((r) => r && !(prueba.fotos_subidas ?? []).includes(r)).length
    : 0;
  const porUnidades = presentacion != null && KG_UNIDAD[presentacion] != null;
  const puedeRegistrar = puedeEditar && (!prueba || prueba.origen === 'logistica');

  return (
    <details className={`carga-camion agregar prueba-entrega${conNovedad ? ' con-novedad' : ''}`} open={!prueba || !!conNovedad}>
      <summary>
        Prueba de entrega:{' '}
        {prueba
          ? <strong>{conNovedad ? `con novedad (${NOVEDAD[prueba.novedad as Novedad] ?? prueba.novedad})` : 'recibido conforme'}</strong>
          : <strong>sin confirmar</strong>}
        {!prueba && <span className="etiqueta sin-peso">Sin prueba</span>}
      </summary>

      {prueba ? (
        <>
          <ul className="datos-camion">
            <li>Recibió: <strong>{prueba.recibido_por}</strong> · {hora(prueba.registrada_en)}
              {' '}({prueba.origen === 'chofer' ? 'registrado por el chofer en la app' : 'registrado por logística'})</li>
            <li>Recibido: <strong>{textoCantidad(prueba.presentacion, prueba.unidades_recibidas, Number(prueba.kg_recibidos))}</strong>
              {prueba.kg_despachados != null && <> de {miles(Number(prueba.kg_despachados))} kg despachados</>}
              {dif != null && dif !== 0 && <> · <strong className={dif < 0 ? 'texto-alerta' : undefined}>{dif > 0 ? '+' : ''}{miles(dif)} kg</strong></>}
            </li>
            {prueba.novedad !== 'sin_novedad' && <li>Novedad: <strong>{NOVEDAD[prueba.novedad as Novedad] ?? prueba.novedad}</strong>{prueba.nota && <> · {prueba.nota}</>}</li>}
            {prueba.novedad === 'sin_novedad' && prueba.nota && <li>Nota: {prueba.nota}</li>}
            {prueba.sin_guia && <li className="alerta">El chofer indicó que no le dieron guía firmada.</li>}
            {fotosPendientes > 0 && (
              <li className="nota-estimado">
                {fotosPendientes === 1 ? '1 foto aún no llegó' : `${fotosPendientes} fotos aún no llegaron`}: el teléfono las envía al recuperar señal.
              </li>
            )}
          </ul>
          {(prueba.enlaceGuia || (prueba.enlacesNovedad ?? []).some(Boolean)) && (
            <div className="fotos-enlaces">
              {prueba.enlaceGuia && (
                <a href={prueba.enlaceGuia} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={prueba.enlaceGuia} alt="Guía firmada" loading="lazy" />
                </a>
              )}
              {(prueba.enlacesNovedad ?? []).map((url, n) => url && (
                <a key={n} href={url} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={`Foto ${n + 1} de la novedad`} loading="lazy" />
                </a>
              ))}
            </div>
          )}
        </>
      ) : (
        <p className="nota-estimado">
          El chofer marcó «Entregado» sin prueba de entrega (app anterior). Mientras no se registre, el cumplimiento usa el peso de fábrica.
        </p>
      )}

      {puedeRegistrar && (
        <details className="agregar no-imprimir">
          <summary>{prueba ? 'Corregir la prueba de entrega' : 'Registrar la prueba de entrega'}</summary>
          <p className="ayuda">
            Con lo que informó el cliente o el chofer. Salió: <strong>{textoCantidad(presentacion, unidadesSalida, kgSalida)}</strong>.
            La guía firmada se sube en Documentos.
          </p>
          <FormularioAccion accion={registrarEntrega.bind(null, asignacionId, misionId, porUnidades)}
            boton={prueba ? 'Guardar corrección' : 'Registrar entrega'} cancelar>
            <label><span className="etiqueta-campo">¿Quién recibió? <Req /></span>
              <input name="recibido_por" required maxLength={120} defaultValue={prueba?.recibido_por ?? ''} placeholder="Nombre y cargo" />
            </label>
            {kgSalida != null && (
              <label className="casilla"><input type="checkbox" name="completo" value="si" /> Recibieron todo completo</label>
            )}
            <label><span className="etiqueta-campo">{porUnidades ? 'Unidades recibidas' : 'Kg recibidos'}{kgSalida == null && <> <Req /></>}</span>
              <input name="cantidad" inputMode="decimal" maxLength={8}
                defaultValue={prueba ? (porUnidades ? prueba.unidades_recibidas ?? '' : prueba.kg_recibidos) : ''}
                placeholder={kgSalida != null ? 'Si no recibieron todo' : ''} />
            </label>
            <label><span className="etiqueta-campo">Novedad</span>
              <select name="novedad" defaultValue={prueba?.novedad ?? 'sin_novedad'}>
                {(Object.keys(NOVEDAD) as Novedad[]).map((n) => <option key={n} value={n}>{NOVEDAD[n]}</option>)}
              </select>
            </label>
            <label><span className="etiqueta-campo">Detalle</span>
              <input name="nota" maxLength={300} defaultValue={prueba?.nota ?? ''} placeholder="Obligatorio si la novedad es «Otra»" />
            </label>
          </FormularioAccion>
        </details>
      )}
    </details>
  );
}
