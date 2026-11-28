'use client';
import { useState } from 'react';
import { Req } from './Obligatorio';

/** Casilla «Con transbordo» al crear una misión: pide la empresa del segundo tramo y el lugar aproximado. */
export default function SeccionTransbordo({ transportistas }: { transportistas: { id: string; nombre: string }[] }) {
  const [activo, setActivo] = useState(false);
  return (
    <>
      <label className="casilla">
        <input type="checkbox" name="con_transbordo" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
        La carga pasa a otro camión en el camino (transbordo, por ejemplo en El Alto)
      </label>
      {activo && (
        <div className="rejilla">
          <label>
            Empresa que hará el tramo después del transbordo <Req />
            <select name="transportista_tramo2" required defaultValue="">
              <option value="" disabled>Seleccione…</option>
              {transportistas.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
            </select>
          </label>
          <label>
            Lugar aproximado del transbordo
            <input name="lugar_tramo2" placeholder="Ej. El Alto, zona Senkata" />
          </label>
        </div>
      )}
      {activo && (
        <p className="ayuda">
          Los camiones y choferes del segundo tramo se agregan después, desde el detalle de la misión, cuando los conozca.
          El camión de abajo es el que sale de fábrica.
        </p>
      )}
    </>
  );
}
