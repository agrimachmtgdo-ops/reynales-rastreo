import Link from 'next/link';
import ImportarPedidos from '@/componentes/ImportarPedidos';
import { opcionesPedido, permisosPedidos } from '@/lib/pedidosServidor';

export const dynamic = 'force-dynamic';

export default async function PaginaImportarPedidos() {
  const { puedeCargar } = await permisosPedidos();
  if (!puedeCargar) {
    return <section className="tarjeta"><h1>Importar pedidos</h1><p>Solo el administrador o un comercial cargan pedidos.</p><Link href="/pedidos">Volver a pedidos</Link></section>;
  }
  const { clientes, ubicaciones } = await opcionesPedido();
  return (
    <>
      <p className="migas"><Link href="/pedidos">Pedidos</Link> › Importar desde Excel</p>
      <h1>Importar pedidos desde Excel</h1>
      <ImportarPedidos clientes={clientes} ubicaciones={ubicaciones} />
    </>
  );
}
