import { crearClienteServidor } from '@/lib/supabase/server';
import { SELECT_ASIGNACION_EN_VIVO } from '@/lib/consultas';
import type { AsignacionEnVivo } from '@/lib/tipos';
import TableroEnVivo from '@/componentes/TableroEnVivo';
import FormularioAccion from '@/componentes/FormularioAccion';
import { MINUTOS_DETENIDO } from '@/lib/tipos';
import { fijarMinutosDetenido } from './misiones/acciones';

export const dynamic = 'force-dynamic';

export default async function PaginaTablero() {
  const supabase = await crearClienteServidor();
  const [{ data: config }, { data: puedeEditar }] = await Promise.all([
    supabase.from('configuracion').select('valor').eq('clave', 'detenido_minutos').maybeSingle(),
    supabase.rpc('puede_editar'),
  ]);
  const minDetenido = Number(config?.valor) > 0 ? Number(config?.valor) : MINUTOS_DETENIDO;
  const { data, error } = await supabase
    .from('asignaciones')
    .select(SELECT_ASIGNACION_EN_VIVO)
    .not('etapa', 'in', '(entregado,cancelado)')
    .order('ultima_senal', { ascending: false, nullsFirst: false });

  if (error) return <div className="mensaje-error">No se pudo cargar el tablero: {error.message}</div>;

  return (
    <>
      <TableroEnVivo iniciales={(data ?? []) as unknown as AsignacionEnVivo[]} minDetenido={minDetenido} />
      {puedeEditar === true && (
        <details className="agregar tarjeta" style={{ marginTop: 16 }}>
          <summary>Ajustar aviso de «Detenido» (ahora: {minDetenido} min)</summary>
          <p className="ayuda">Un camión en ruta que no se mueve más de 300 m durante este tiempo se marca «Detenido». No aplica en frontera.</p>
          <FormularioAccion accion={fijarMinutosDetenido} boton="Guardar">
            <label>Minutos sin moverse<input name="minutos" inputMode="numeric" defaultValue={minDetenido} style={{ maxWidth: 140 }} /></label>
          </FormularioAccion>
        </details>
      )}
    </>
  );
}
