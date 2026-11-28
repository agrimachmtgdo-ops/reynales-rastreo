'use client';
import { Req } from './Obligatorio';
import { useState } from 'react';
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
  return (
    <>
      <fieldset className="grupo-campos">
        <legend>¿Quién lleva la carga?</legend>
        <div className="rejilla rejilla-3">
          <label>
            Transportista <Req />
            <select name="transportista_id" required value={transportista} onChange={(e) => setTransportista(e.target.value)}>
              <option value="" disabled>Seleccione…</option>
              {catalogos.transportistas.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
            </select>
            <span className="ayuda-campo">
              {sugerida ? 'Empresa prevista para este tramo.' : transportista ? `${conductores.length} ${conductores.length === 1 ? 'chofer' : 'choferes'} · ${vehiculos.length} ${vehiculos.length === 1 ? 'vehículo' : 'vehículos'}` : 'Al elegirla se cargan sus choferes y placas.'}
            </span>
          </label>
          <label>
            Chofer <Req />
            <select name="conductor_id" required key={`c-${transportista}`} defaultValue={conductores.length === 1 ? conductores[0]!.id : ''} disabled={!transportista}>
              <option value="" disabled>{transportista ? 'Seleccione…' : 'Primero el transportista'}</option>
              {conductores.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </label>
          <label>
            Placa del camión <Req />
            <select name="vehiculo_id" required key={`v-${transportista}`} defaultValue={vehiculos.length === 1 ? vehiculos[0]!.id : ''} disabled={!transportista}>
              <option value="" disabled>{transportista ? 'Seleccione…' : 'Primero el transportista'}</option>
              {vehiculos.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
            </select>
          </label>
        </div>
        {faltan && (
          <p className="alerta">
            Este transportista no tiene {conductores.length === 0 && vehiculos.length === 0 ? 'choferes ni vehículos' : conductores.length === 0 ? 'choferes' : 'vehículos'} registrados.
            Agréguelos en <Link href={`/catalogos?pestana=${conductores.length === 0 ? 'conductores' : 'vehiculos'}`}>Catálogos</Link>.
          </p>
        )}
      </fieldset>
      <fieldset className="grupo-campos">
        <legend>Carga</legend>
        <div className="rejilla rejilla-3">
          {declaradas ? (
            <>
              <label>
                Toneladas declaradas
                <input name="toneladas_declaradas" inputMode="decimal" placeholder="Ej. 29,0" />
                <span className="ayuda-campo">Las que recibe en el transbordo. Puede anotarlas después.</span>
              </label>
              <label>
                N.º de precinto <Req />
                <input name="precinto" required autoComplete="off" placeholder="Ej. 004512" />
                <span className="ayuda-campo">El precinto que se coloca al cargar en el transbordo.</span>
              </label>
            </>
          ) : (
            <label>
              Toneladas del ticket de balanza
              <input name="toneladas_cargadas" inputMode="decimal" placeholder="Ej. 29,4" />
              <span className="ayuda-campo">Si aún no se pesó, déjelo vacío y anótelo después.</span>
            </label>
          )}
        </div>
      </fieldset>
      <label className="casilla casilla-secundaria">
        <input type="checkbox" name="asignar_igual" />
        <span>Permitir aunque el chofer o el camión ya estén en otro viaje activo</span>
      </label>
    </>
  );
}
