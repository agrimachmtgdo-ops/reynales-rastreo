'use client';
import { Req } from './Obligatorio';
import { useId, useState } from 'react';
import Link from 'next/link';
import type { CatalogosCamion } from '@/lib/catalogos';

/**
 * Transportista → filtra choferes y vehículos de ese transportista.
 * Después de un transbordo se propone la empresa prevista del tramo y las toneladas son declaradas.
 */
export default function CamposCamion({
  catalogos,
  transportistaInicial,
  declaradas = false,
}: {
  catalogos: CatalogosCamion;
  transportistaInicial?: string | null;
  declaradas?: boolean;
}) {
  const unico = catalogos.transportistas.length === 1 ? catalogos.transportistas[0]!.id : '';
  const [transportista, setTransportista] = useState(transportistaInicial ?? unico);
  const conductores = catalogos.conductores.filter((c) => c.transportista_id === transportista);
  const vehiculos = catalogos.vehiculos.filter((v) => v.transportista_id === transportista);

  if (catalogos.transportistas.length === 0) {
    return <p className="alerta">Primero registre transportistas, choferes y vehículos en <Link href="/catalogos?pestana=transportistas">Catálogos</Link>.</p>;
  }
  const faltan = transportista !== '' && (conductores.length === 0 || vehiculos.length === 0);
  const sugerida = transportistaInicial && transportista === transportistaInicial;
  const uid = useId();
  const ayudaEmpresa = sugerida
    ? 'Empresa prevista para este tramo.'
    : transportista
      ? `${conductores.length} ${conductores.length === 1 ? 'chofer' : 'choferes'} y ${vehiculos.length} ${vehiculos.length === 1 ? 'camión' : 'camiones'} registrados.`
      : 'Al elegirla se cargan sus choferes y placas.';
  return (
    <div className="form-secciones">
      <fieldset className="seccion-form">
        <div className="seccion-titulo">
          <legend>Transporte</legend>
          <p>Empresa, chofer y camión que llevan la carga.</p>
        </div>
        <div className="seccion-campos">
          <div className="rejilla rejilla-3">
            <label>
              <span className="etiqueta-campo">Transportista <Req /></span>
              <select name="transportista_id" required value={transportista} onChange={(e) => setTransportista(e.target.value)} aria-describedby={`${uid}-emp`}>
                <option value="" disabled>Seleccione…</option>
                {catalogos.transportistas.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
              </select>
              <span className="ayuda-campo" id={`${uid}-emp`}>{ayudaEmpresa}</span>
            </label>
            <label>
              <span className="etiqueta-campo">Chofer <Req /></span>
              <select name="conductor_id" required key={`c-${transportista}`} defaultValue={conductores.length === 1 ? conductores[0]!.id : ''} disabled={!transportista}>
                <option value="" disabled>{transportista ? 'Seleccione…' : 'Primero elija la empresa'}</option>
                {conductores.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </label>
            <label>
              <span className="etiqueta-campo">Placa del camión <Req /></span>
              <select name="vehiculo_id" required key={`v-${transportista}`} defaultValue={vehiculos.length === 1 ? vehiculos[0]!.id : ''} disabled={!transportista}>
                <option value="" disabled>{transportista ? 'Seleccione…' : 'Primero elija la empresa'}</option>
                {vehiculos.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
              </select>
            </label>
          </div>
          {faltan && (
            <p className="alerta" role="alert">
              Esta empresa no tiene {conductores.length === 0 && vehiculos.length === 0 ? 'choferes ni camiones' : conductores.length === 0 ? 'choferes' : 'camiones'} registrados.
              Agréguelos en <Link href={`/catalogos?pestana=${conductores.length === 0 ? 'conductores' : 'vehiculos'}`}>Catálogos</Link>.
            </p>
          )}
          <label className="casilla casilla-secundaria">
            <input type="checkbox" name="asignar_igual" aria-describedby={`${uid}-casilla`} />
            <span>
              Permitir aunque el chofer o el camión ya estén en otro viaje activo
              <span className="ayuda-campo" id={`${uid}-casilla`}>Úselo solo si el viaje anterior quedó abierto por error.</span>
            </span>
          </label>
        </div>
      </fieldset>
      <fieldset className="seccion-form">
        <div className="seccion-titulo">
          <legend>Carga</legend>
          <p>{declaradas ? 'Lo que recibe este camión en el transbordo.' : 'Peso según el ticket de balanza de fábrica.'}</p>
        </div>
        <div className="seccion-campos">
          <div className="rejilla rejilla-3">
            {declaradas ? (
              <>
                <label>
                  <span className="etiqueta-campo">Toneladas declaradas</span>
                  <span className="campo-unidad"><input name="toneladas_declaradas" inputMode="decimal" placeholder="29,0" aria-describedby={`${uid}-tn`} /><span aria-hidden="true">t</span></span>
                  <span className="ayuda-campo" id={`${uid}-tn`}>Opcional: puede anotarlas después.</span>
                </label>
                <label>
                  <span className="etiqueta-campo">N.º de precinto <Req /></span>
                  <input name="precinto" required autoComplete="off" placeholder="004512" aria-describedby={`${uid}-pre`} />
                  <span className="ayuda-campo" id={`${uid}-pre`}>El que se coloca al cargar en el transbordo.</span>
                </label>
              </>
            ) : (
              <label>
                <span className="etiqueta-campo">Peso de balanza</span>
                <span className="campo-unidad"><input name="toneladas_cargadas" inputMode="decimal" placeholder="29,4" aria-describedby={`${uid}-tn`} /><span aria-hidden="true">t</span></span>
                <span className="ayuda-campo" id={`${uid}-tn`}>Opcional: si aún no se pesó, anótelo después.</span>
              </label>
            )}
          </div>
        </div>
      </fieldset>
    </div>
  );
}
