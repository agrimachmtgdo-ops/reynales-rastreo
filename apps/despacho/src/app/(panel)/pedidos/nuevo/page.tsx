import Link from 'next/link';
import FormularioPedido from '@/componentes/FormularioPedido';
import { opcionesPedido, permisosPedidos } from '@/lib/pedidosServidor';

export const dynamic = 'force-dynamic';

export default async function PaginaNuevoPedido() {
  const { puedeCargar } = await permisosPedidos();
  if (!puedeCargar) {
    return <section className="tarjeta"><h1>Nuevo pedido</h1><p>Solo el administrador o un comercial cargan pedidos.</p><Link href="/pedidos">Volver a pedidos</Link></section>;
  }
  const { clientes, ubicaciones, productos } = await opcionesPedido();
  return (
    <section className="tarjeta">
      <p className="migas"><Link href="/pedidos">Pedidos</Link> › Nuevo</p>
      <h1>Nuevo pedido</h1>
      {clientes.length === 0
        ? <p>No tiene clientes disponibles. Pida al administrador que le asigne clientes en Catálogos → Clientes.</p>
        : <FormularioPedido id={null} clientes={clientes} ubicaciones={ubicaciones} productos={productos} />}
    </section>
  );
}
