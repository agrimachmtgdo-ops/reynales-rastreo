'use client';
import { useState } from 'react';
import type { CatalogosCamion } from '@/lib/catalogos';

/** Transportista → filtra choferes y vehículos de ese transportista. */
export default function CamposCamion({ catalogos }: { catalogos: CatalogosCamion }) {
  const [transportista, setTransportista] = useState(catalogos.transportistas[0]?.id ?? '');
  const conductores = catalogos.conductores.filter((c) => c.transportista_id === transportista);
  const vehiculos = catalogos.vehiculos.filter((v) => v.transportista_id === transportista);

  if (catalogos.transportistas.length === 0) {
    return <p className="alerta">Primero registre transportistas, choferes y vehículos en Catálogos.</p>;
  }
  return (
    <div className="rejilla">
      <label>
        Transportista
        <select name="transportista_id" required value={transportista} onChange={(e) => setTransportista(e.target.value)}>
          {catalogos.transportistas.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
        </select>
      </label>
      <label>
        Chofer
        <select name="conductor_id" required key={`c-${transportista}`}>
          {conductores.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
      </label>
      <label>
        Vehículo (placa)
        <select name="vehiculo_id" required key={`v-${transportista}`}>
          {vehiculos.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
        </select>
      </label>
      <label>
        Toneladas cargadas (balanza)
        <input name="toneladas_cargadas" inputMode="decimal" />
      </label>
    </div>
  );
}
