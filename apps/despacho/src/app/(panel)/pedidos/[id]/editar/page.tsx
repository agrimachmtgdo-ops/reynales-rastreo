import Link from 'next/link';
import { notFound } from 'next/navigation';
import { crearClienteServidor } from '@/lib/supabase/server';
import FormularioPedido from '@/componentes/FormularioPedido';
import { opcionesPedido } from '@/lib/pedidosServidor';

export const dynamic = 'force-dynamic';

export default async function PaginaEditarPedido({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await crearClienteServidor();
  const { data: p } = await supabase.from('pedidos')
    .select('id, codigo, cliente_id, orden_compra, producto, destino_id, incoterm, notas, estado, envios:programa_envios(numero, toneladas, entrega_vigente, fecha_carga_planificada)')
    .eq('id', id).maybeSingle();
  if (!p) notFound();
  const { data: puede } = await supabase.rpc('puede_editar_pedidos', { p_cliente: p.cliente_id });

  const volver = <Link href={`/pedidos/${id}`}>Volver al pedido</Link>;
  if (p.estado !== 'borrador') {
    return <section className="tarjeta"><h1>{p.codigo}</h1><p>El pedido ya está confirmado: cambie cada envío con «Reprogramar» para que quede el historial.</p>{volver}</section>;
  }
  if (!puede) {
    return <section className="tarjeta"><h1>{p.codigo}</h1><p>Solo el administrador o el comercial de este cliente pueden cambiar el pedido.</p>{volver}</section>;
  }
  const { clientes, ubicaciones } = await opcionesPedido();
  const envios = [...(p.envios ?? [])].sort((a, b) => a.numero - b.numero)
    .map((e) => ({ toneladas: Number(e.toneladas), entrega: e.entrega_vigente as string, carga: (e.fecha_carga_planificada as string | null) ?? null }));

  return (
    <section className="tarjeta">
      <p className="migas"><Link href="/pedidos">Pedidos</Link> › <Link href={`/pedidos/${id}`}>{p.codigo}</Link> › Editar</p>
      <h1>Editar {p.codigo}</h1>
      <FormularioPedido id={id} clientes={clientes} ubicaciones={ubicaciones} envios={envios}
        inicial={{ cliente_id: p.cliente_id, orden_compra: p.orden_compra, producto: p.producto, destino_id: p.destino_id, incoterm: p.incoterm, notas: p.notas }} />
    </section>
  );
}
