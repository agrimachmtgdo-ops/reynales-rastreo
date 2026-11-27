import Link from 'next/link';
import { ETIQUETA_ETAPA, type Etapa } from '@reynales/shared';
import { crearClienteServidor } from '@/lib/supabase/server';
import { formatoHora } from '@/lib/tipos';

export const dynamic = 'force-dynamic';

interface FilaMision {
  id: string;
  codigo: string;
  etapa: Etapa;
  factura: string | null;
  creado_en: string;
  cliente: { razon_social: string } | null;
  destino: { nombre: string; pais: string } | null;
  asignaciones: { id: string }[];
}

export default async function PaginaMisiones() {
  const supabase = await crearClienteServidor();
  const { data, error } = await supabase
    .from('misiones')
    .select('id, codigo, etapa, factura, creado_en, cliente:clientes(razon_social), destino:ubicaciones!misiones_destino_id_fkey(nombre, pais), asignaciones(id)')
    .order('creado_en', { ascending: false })
    .limit(100);
  if (error) return <div className="mensaje-error">{error.message}</div>;
  const misiones = (data ?? []) as unknown as FilaMision[];

  return (
    <section className="tarjeta">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>Misiones</h1>
        <Link className="boton" href="/misiones/nueva">Nueva misión</Link>
      </div>
      <table>
        <thead>
          <tr><th>Código</th><th>Cliente</th><th>Destino</th><th>Factura</th><th>Camiones</th><th>Etapa</th><th>Creada</th></tr>
        </thead>
        <tbody>
          {misiones.map((m) => (
            <tr key={m.id}>
              <td><Link href={`/misiones/${m.id}`}>{m.codigo}</Link></td>
              <td>{m.cliente?.razon_social}</td>
              <td>{m.destino?.nombre} ({m.destino?.pais})</td>
              <td>{m.factura}</td>
              <td>{m.asignaciones.length}</td>
              <td><span className={`etiqueta ${m.etapa}`}>{ETIQUETA_ETAPA[m.etapa]}</span></td>
              <td>{formatoHora(m.creado_en)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {misiones.length === 0 && <p>Aún no hay misiones. Cree la primera con “Nueva misión”.</p>}
    </section>
  );
}
