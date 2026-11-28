import Link from 'next/link';
import { crearClienteServidor } from '@/lib/supabase/server';
import { cargarInspecciones } from '@/lib/inspeccionServidor';
import { estadoCarga, TEXTO_ESTADO_CARGA, type EstadoCarga } from '@/lib/inspeccion';
import { formatoKg } from '@/lib/lotes';
import FormularioAccion from '@/componentes/FormularioAccion';
import { fijarInspeccionObligatoria } from './acciones';

export const dynamic = 'force-dynamic';

interface CamionFabrica {
  id: string;
  mision_id: string;
  kg_lotes: number | null;
  toneladas_cargadas: number | null;
  mision: { codigo: string; cliente: { razon_social: string } | null; destino: { nombre: string } | null } | null;
  vehiculo: { placa: string } | null;
  conductor: { nombre: string } | null;
  transportista: { razon_social: string } | null;
}

const ORDEN: EstadoCarga[] = ['rechazado', 'sin_inspeccion', 'liberado', 'cargando', 'cerrada'];

/** Almacén (celular): camiones en fábrica por inspeccionar, cargando y listos para salir. */
export default async function PaginaAlmacen() {
  const supabase = await crearClienteServidor();
  const [{ data: perfil }, { data }] = await Promise.all([
    supabase.rpc('perfil_actual'),
    supabase.from('asignaciones')
      .select('id, mision_id, kg_lotes, toneladas_cargadas, mision:misiones(codigo, cliente:clientes(razon_social), destino:ubicaciones!misiones_destino_id_fkey(nombre)), vehiculo:vehiculos(placa), conductor:conductores(nombre), transportista:transportistas(razon_social)')
      .eq('etapa', 'programado').eq('tramo', 1).order('creado_en').limit(200),
  ]);
  const camiones = (data ?? []) as unknown as CamionFabrica[];
  const { inspecciones, cierres, obligatoria } = await cargarInspecciones(supabase, camiones.map((c) => c.id));
  const estadoDe = (id: string) => {
    const c = cierres.find((x) => x.id === id);
    return c ? estadoCarga(c, inspecciones.filter((i) => i.asignacion_id === id)) : 'sin_inspeccion';
  };
  const precintoDe = (id: string) => cierres.find((x) => x.id === id)?.precinto ?? null;
  const ordenados = [...camiones].sort((a, b) => ORDEN.indexOf(estadoDe(a.id)) - ORDEN.indexOf(estadoDe(b.id)));
  const puedeVer = perfil === 'administrador' || perfil === 'logistica' || perfil === 'almacen';

  return (
    <section className="tarjeta pagina-almacen">
      <h1 style={{ marginTop: 0 }}>Almacén</h1>
      <p className="ayuda" style={{ marginTop: 0 }}>
        Camiones en fábrica. Antes de cargar, inspeccione el camión (6 puntos y 2 fotos). Después registre los lotes y la balanza, y cierre la carga con el precinto.
      </p>
      <p className={obligatoria ? 'mensaje-ok' : 'nota-estimado'} role="status">
        {obligatoria
          ? 'Bloqueo activo: sin inspección aprobada no se carga, y sin carga cerrada el chofer no puede iniciar el viaje.'
          : 'Modo alerta: el camión puede salir sin inspección, pero queda una alerta en la misión y en cumplimiento.'}
      </p>
      {perfil === 'administrador' && (
        <details className="agregar no-imprimir">
          <summary>{obligatoria ? 'Pasar a modo alerta' : 'Activar el bloqueo'}</summary>
          <p className="ayuda">
            {obligatoria
              ? 'Los camiones podrán salir sin inspección ni precinto; quedará una alerta.'
              : 'Actívelo cuando almacén ya inspeccione todos los camiones. El administrador puede liberar un camión por excepción, con motivo.'}
          </p>
          <FormularioAccion accion={fijarInspeccionObligatoria} boton={obligatoria ? 'Pasar a modo alerta' : 'Activar el bloqueo'} claseBoton="boton secundario">
            <input type="hidden" name="valor" value={obligatoria ? 'false' : 'true'} />
          </FormularioAccion>
        </details>
      )}

      {!puedeVer && <p className="nota-estimado">Esta sección es de almacén, logística y el administrador. Usted puede ver la lista sin cambiar nada.</p>}
      {ordenados.length === 0 ? (
        <p className="nota-estimado">No hay camiones esperando en fábrica.</p>
      ) : (
        <ul className="lista-almacen">
          {ordenados.map((c) => {
            const estado = estadoDe(c.id);
            return (
              <li key={c.id} className={`estado-${estado}`}>
                <Link href={`/almacen/${c.id}`}>
                  <span className="placa">{c.vehiculo?.placa ?? 'Sin placa'}</span>
                  <span className={`etiqueta carga-${estado}`}>{TEXTO_ESTADO_CARGA[estado]}</span>
                  <span className="detalle">
                    {c.mision?.codigo} · {c.mision?.cliente?.razon_social} → {c.mision?.destino?.nombre}
                  </span>
                  <span className="detalle">
                    {c.conductor?.nombre ?? 'Sin chofer'} · {c.transportista?.razon_social ?? ''}
                    {c.kg_lotes != null && <> · lotes {formatoKg(Number(c.kg_lotes))}</>}
                    {c.toneladas_cargadas != null && <> · balanza {Number(c.toneladas_cargadas).toLocaleString('es-BO')} t</>}
                    {precintoDe(c.id) && <> · precinto {precintoDe(c.id)}</>}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
