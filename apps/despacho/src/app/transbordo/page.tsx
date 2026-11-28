import Link from 'next/link';
import { ETIQUETA_ETAPA, type Etapa } from '@reynales/shared';
import { crearClienteServidor } from '@/lib/supabase/server';
import RefrescoPeriodico from '@/componentes/RefrescoPeriodico';

export const dynamic = 'force-dynamic';

interface Carga {
  id: string; codigo: string; etapa: Etapa; tramo: number; lugar: string | null; cliente: string; destino: string;
  llegan: number; recibidos: number; mis_camiones: number;
}

/** Cargas que la empresa del operador recibe en el transbordo. */
export default async function PaginaMisCargas() {
  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.rpc('operador_mis_cargas');
  const cargas = (data ?? []) as Carga[];
  return (
    <>
      <div className="barra-tablero">
        <h1 style={{ margin: 0 }}>Mis cargas</h1>
        <RefrescoPeriodico segundos={60} />
      </div>
      {error && <div className="mensaje-error">No se pudieron cargar las cargas: {error.message}</div>}
      {cargas.length === 0 && !error && (
        <div className="tarjeta"><p>No tiene cargas asignadas por ahora. Cuando despacho le asigne un transbordo aparecerá aquí.</p></div>
      )}
      <ul className="lista-cargas">
        {cargas.map((c) => (
          <li key={c.id}>
            <Link href={`/transbordo/${c.id}`} className="tarjeta carga-enlace">
              <span className="carga-titulo">
                <strong>{c.codigo}</strong>
                <span className={`etiqueta ${c.etapa}`}>{ETIQUETA_ETAPA[c.etapa]}</span>
              </span>
              <span>{c.cliente} · hacia {c.destino}</span>
              <span className="ayuda" style={{ margin: 0 }}>
                Transbordo{c.lugar ? ` en ${c.lugar}` : ''} · Recibidos {c.recibidos} de {c.llegan} camiones · Sus camiones: {c.mis_camiones}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
