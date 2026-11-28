'use client';
import { Req } from './Obligatorio';
import { useState } from 'react';
import Link from 'next/link';
import type { CatalogosCamion } from '@/lib/catalogos';

/** Transportista → filtra choferes y vehículos de ese transportista. */
export default function CamposCamion({ catalogos }: { catalogos: CatalogosCamion }) {
  const unico = catalogos.transportistas.length === 1 ? catalogos.transportistas[0]!.id : '';
  const [transportista, setTransportista] = useState(unico);
  const conductores = catalogos.conductores.filter((c) => c.transportista_id === transportista);
  const vehiculos = catalogos.vehiculos.filter((v) => v.transportista_id === transportista);

  if (catalogos.transportistas.length === 0) {
    return <p className="alerta">Primero registre transportistas, choferes y vehículos en <Link href="/catalogos?pestana=transportistas">Catálogos</Link>.</p>;
  }
  const faltan = transportista !== '' && (conductores.length === 0 || vehiculos.length === 0);
  return (
    <>
      <div className="rejilla">
        <label>
          Transportista <Req />
          <select name="transportista_id" required value={transportista} onChange={(e) => setTransportista(e.target.value)}>
            <option value="" disabled>Seleccione…</option>
            {catalogos.transportistas.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
          </select>
        </label>
        <label>
          Chofer <Req />
          <select name="conductor_id" required key={`c-${transportista}`} defaultValue={conductores.length === 1 ? conductores[0]!.id : ''} disabled={!transportista}>
            <option value="" disabled>{transportista ? 'Seleccione…' : 'Elija primero el transportista'}</option>
            {conductores.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </label>
        <label>
          Vehículo (placa) <Req />
          <select name="vehiculo_id" required key={`v-${transportista}`} defaultValue={vehiculos.length === 1 ? vehiculos[0]!.id : ''} disabled={!transportista}>
            <option value="" disabled>{transportista ? 'Seleccione…' : 'Elija primero el transportista'}</option>
            {vehiculos.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
          </select>
        </label>
        <label>
          Toneladas cargadas (balanza)
          <input name="toneladas_cargadas" inputMode="decimal" />
        </label>
      </div>
      <label className="casilla">
        <input type="checkbox" name="asignar_igual" />
        Asignar igual aunque el chofer o el camión estén en otro viaje activo
      </label>
      {faltan && (
        <p className="alerta">
          Este transportista no tiene {conductores.length === 0 && vehiculos.length === 0 ? 'choferes ni vehículos' : conductores.length === 0 ? 'choferes' : 'vehículos'} registrados.
          Agréguelos en <Link href={`/catalogos?pestana=${conductores.length === 0 ? 'conductores' : 'vehiculos'}`}>Catálogos</Link>.
        </p>
      )}
    </>
  );
}
