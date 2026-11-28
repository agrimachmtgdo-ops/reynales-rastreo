import { crearClienteServidor } from '@/lib/supabase/server';
import { cargarReporte } from '@/lib/reportesServidor';
import { leerFiltros, periodoAnterior } from '@/lib/reportes';
import ContenidoReporte from '@/componentes/ContenidoReporte';

export const dynamic = 'force-dynamic';

/** Reporte de operaciones entregadas: por fecha de entrega (hora de Bolivia). */
export default async function PaginaReportes({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const filtros = leerFiltros(await searchParams);
  const supabase = await crearClienteServidor();
  const [actual, previo, { data: clientes }, { data: transportistas }, { data: productos }] = await Promise.all([
    cargarReporte(filtros),
    cargarReporte(periodoAnterior(filtros)),
    supabase.from('clientes').select('id, razon_social').order('razon_social'),
    supabase.from('transportistas').select('id, razon_social').order('razon_social'),
    supabase.from('productos').select('id, nombre').order('nombre'),
  ]);
  if (actual.error) return <div className="tarjeta mensaje-error">No se pudo armar el reporte: {actual.error}</div>;
  return (
    <ContenidoReporte filtros={filtros} filas={actual.filas} filasAnteriores={previo.filas}
      clientes={clientes ?? []} transportistas={transportistas ?? []} productos={productos ?? []} />
  );
}

