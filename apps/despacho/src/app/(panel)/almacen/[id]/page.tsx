import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ETIQUETA_ETAPA, type Etapa } from '@reynales/shared';
import { crearClienteServidor } from '@/lib/supabase/server';
import { cargarInspecciones } from '@/lib/inspeccionServidor';
import { cargarProductos } from '@/lib/productosServidor';
import { TOLERANCIA_LOTES_PCT, type LoteCamion } from '@/lib/lotes';
import InspeccionCamion from '@/componentes/InspeccionCamion';
import CargaCamion from '@/componentes/CargaCamion';

export const dynamic = 'force-dynamic';

/** Un camión en fábrica, para almacén: inspección, lotes, balanza y cierre de carga en una sola pantalla. */
export default async function PaginaCamionAlmacen({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await crearClienteServidor();
  const { data } = await supabase.from('asignaciones')
    .select('id, mision_id, etapa, tramo, toneladas_cargadas, kg_lotes, ticket_balanza, peso_bruto_kg, tara_kg, vehiculo:vehiculos(placa), conductor:conductores(nombre, telefono), transportista:transportistas(razon_social), mision:misiones(codigo, producto_id, cliente:clientes(razon_social), destino:ubicaciones!misiones_destino_id_fkey(nombre))')
    .eq('id', id).maybeSingle();
  if (!data || (data.tramo ?? 1) !== 1) notFound();
  const c = data as unknown as {
    id: string; mision_id: string; etapa: Etapa; tramo: number | null; toneladas_cargadas: number | null; kg_lotes: number | null;
    ticket_balanza: string | null; peso_bruto_kg: number | null; tara_kg: number | null;
    vehiculo: { placa: string } | null; conductor: { nombre: string; telefono: string | null } | null; transportista: { razon_social: string } | null;
    mision: { codigo: string; producto_id: string | null; cliente: { razon_social: string } | null; destino: { nombre: string } | null } | null;
  };

  const [{ data: perfil }, { data: lotesData }, { data: tolData }, productos, carga] = await Promise.all([
    supabase.rpc('perfil_actual'),
    supabase.from('cargas_lote').select('id, asignacion_id, producto_id, lote, fecha_produccion, presentacion, unidades, kg, producto:productos(nombre)')
      .eq('asignacion_id', id).order('creado_en'),
    supabase.from('configuracion').select('valor').eq('clave', 'lotes_tolerancia_pct').maybeSingle(),
    cargarProductos(),
    cargarInspecciones(supabase, [id]),
  ]);
  const puedeCargar = perfil === 'administrador' || perfil === 'logistica' || perfil === 'almacen';
  const tolerancia = Number((tolData as { valor: unknown } | null)?.valor ?? TOLERANCIA_LOTES_PCT) || TOLERANCIA_LOTES_PCT;
  const cierre = carga.cierres[0];

  return (
    <section className="tarjeta pagina-almacen">
      <p className="no-imprimir"><Link href="/almacen">← Camiones en fábrica</Link></p>
      <h1 style={{ marginTop: 0 }}>{c.vehiculo?.placa ?? 'Camión'} <span className={`etiqueta ${c.etapa}`}>{ETIQUETA_ETAPA[c.etapa]}</span></h1>
      <p>
        {c.conductor?.nombre ?? 'Sin chofer'}
        {c.conductor?.telefono && <> · <a href={`tel:${c.conductor.telefono.replace(/[^0-9+]/g, '')}`}>Llamar</a></>}
        {' '}· {c.transportista?.razon_social}<br />
        Misión <Link href={`/misiones/${c.mision_id}`}>{c.mision?.codigo}</Link> · {c.mision?.cliente?.razon_social} → {c.mision?.destino?.nombre}
      </p>
      {c.etapa !== 'programado' && <p className="nota-estimado">Este camión ya salió de fábrica.</p>}

      {cierre && c.etapa !== 'cancelado' && (
        <InspeccionCamion
          cierre={cierre}
          misionId={c.mision_id}
          inspecciones={carga.inspecciones}
          puedeCargar={puedeCargar}
          esAdmin={perfil === 'administrador'}
          obligatoria={carga.obligatoria}
          abierto
        />
      )}
      {c.etapa !== 'cancelado' && (
        <CargaCamion
          camion={{ ...c, tramo: c.tramo ?? 1 }}
          misionId={c.mision_id}
          lotes={(lotesData ?? []) as unknown as LoteCamion[]}
          productos={productos}
          productoMision={c.mision?.producto_id ?? null}
          puedeEditar={puedeCargar}
          tolerancia={tolerancia}
        />
      )}
    </section>
  );
}
