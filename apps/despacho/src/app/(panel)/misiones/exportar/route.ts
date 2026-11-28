import { ETIQUETA_ETAPA } from '@reynales/shared';
import { buscarMisiones } from '@/lib/misiones';
import { formatoHora } from '@/lib/tipos';

export const dynamic = 'force-dynamic';

// Excel en español usa ";" como separador; el BOM hace que lea bien las tildes.
const celda = (v: unknown) => {
  const t = v === null || v === undefined ? '' : String(v);
  return /[";\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

export async function GET(peticion: Request) {
  const p = new URL(peticion.url).searchParams;
  const { filas, error } = await buscarMisiones(
    { q: p.get('q') ?? undefined, etapa: p.get('etapa') ?? undefined, desde: p.get('desde') ?? undefined, hasta: p.get('hasta') ?? undefined },
    5000,
  );
  if (error) return new Response(`No se pudo exportar: ${error}`, { status: 500 });

  const encabezado = ['Código', 'Pedido', 'Envío', 'Producto', 'Etapa', 'Cliente', 'Origen', 'Destino', 'País', 'Entrega comprometida', 'Factura', 'Guía', 'DEX', 'TN objetivo', 'TN cargadas (balanza)', 'Camiones sin peso', 'Placas', 'Choferes', 'Creada'];
  const lineas = filas.map((m) => [
    m.codigo, m.envio?.pedido?.codigo, m.envio?.numero, m.producto?.nombre ?? m.tipo_carga ?? m.envio?.pedido?.producto,
    ETIQUETA_ETAPA[m.etapa], m.cliente?.razon_social, m.origen?.nombre, m.destino?.nombre, m.destino?.pais,
    m.entrega_comprometida, m.factura, m.guia, m.dex, m.tonelaje_objetivo,
    m.asignaciones.filter((a) => (a.tramo ?? 1) === 1 && a.etapa !== 'cancelado' && a.toneladas_cargadas != null)
      .reduce((t, a) => t + Number(a.toneladas_cargadas), 0).toLocaleString('es-BO', { maximumFractionDigits: 2 }),
    m.asignaciones.filter((a) => (a.tramo ?? 1) === 1 && a.etapa !== 'cancelado' && a.etapa !== 'programado' && a.toneladas_cargadas == null).length,
    m.asignaciones.map((a) => a.vehiculo?.placa).filter(Boolean).join(' / '),
    m.asignaciones.map((a) => a.conductor?.nombre).filter(Boolean).join(' / '),
    formatoHora(m.creado_en),
  ].map(celda).join(';'));

  const fecha = new Date().toISOString().slice(0, 10);
  return new Response('﻿' + [encabezado.join(';'), ...lineas].join('\r\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="misiones-${fecha}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
