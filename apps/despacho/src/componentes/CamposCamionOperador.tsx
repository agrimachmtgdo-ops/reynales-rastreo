'use client';
import { useState } from 'react';
import { Req } from './Obligatorio';

/** Camión del operador: placa (propia o nueva) y chofer (de la lista o nuevo). */
export default function CamposCamionOperador({
  conductores,
  placas,
}: {
  conductores: { id: string; nombre: string }[];
  placas: string[];
}) {
  const [conductor, setConductor] = useState(conductores.length === 0 ? 'nuevo' : '');
  return (
    <>
      <div className="rejilla">
        <label>
          Placa del camión <Req />
          <input name="placa" required list="placas-operador" placeholder="1234ABC" autoCapitalize="characters" autoComplete="off" />
          <datalist id="placas-operador">{placas.map((p) => <option key={p} value={p} />)}</datalist>
        </label>
        <label>
          Chofer <Req />
          <select name="conductor_id" required value={conductor} onChange={(e) => setConductor(e.target.value)}>
            <option value="" disabled>Seleccione…</option>
            {conductores.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            <option value="nuevo">+ Chofer nuevo</option>
          </select>
        </label>
        {conductor === 'nuevo' && (
          <>
            <label>Nombre del chofer <Req /><input name="chofer_nombre" required autoComplete="off" /></label>
            <label>WhatsApp del chofer <Req /><input name="chofer_telefono" required inputMode="tel" placeholder="+59171234567" /></label>
            <label>CI del chofer<input name="chofer_ci" autoComplete="off" /></label>
          </>
        )}
        <label>Toneladas que lleva <Req /><input name="toneladas" required inputMode="decimal" placeholder="14,5" /></label>
        <label>N.º de precinto <Req /><input name="precinto" required autoComplete="off" /></label>
      </div>
    </>
  );
}
