import { crearClienteServidor } from '@/lib/supabase/server';
import { SELECT_ASIGNACION_EN_VIVO } from '@/lib/consultas';
import type { AsignacionEnVivo } from '@/lib/tipos';
import TableroEnVivo from '@/componentes/TableroEnVivo';

export const dynamic = 'force-dynamic';

export default async function PaginaTablero() {
  const supabase = await crearClienteServidor();
  const { data, error } = await supabase
    .from('asignaciones')
    .select(SELECT_ASIGNACION_EN_VIVO)
    .not('etapa', 'in', '(entregado,cancelado)')
    .order('ultima_senal', { ascending: false, nullsFirst: false });

  if (error) return <div className="mensaje-error">No se pudo cargar el tablero: {error.message}</div>;

  return <TableroEnVivo iniciales={(data ?? []) as unknown as AsignacionEnVivo[]} />;
}
