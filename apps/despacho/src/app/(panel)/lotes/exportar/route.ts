import { ETIQUETA_ETAPA, type Etapa } from '@reynales/shared';
import { buscarLote } from '@/lib/lotesServidor';
import { nombrePresentacion } from '@/lib/lotes';
import { formatoHora } from '@/lib/tipos';

export const dynamic = 'force-dynamic';

// Excel en español usa ";" como separador; el BOM hace que lea bien las tildes.
const celda = (v: unknown) => {
  const t = v === null || v === undefined ? '' : String(v);
  return /[";\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

/** CSV de la búsqueda por lote (para un reclamo o una auditoría). */
export async function GET(peticion: Request) {
  const q = (new URL(peticion.url).searchParams.get('q') ?? '').trim();
  if (q.length < 2) return new Response('Escriba al menos 2 caracteres del lote.', { status: 400 });
  const { filas, error } = await buscarLote(q);
  if (error) return new Response(`No se pudo exportar: ${error}`, { status: 500 });

  const encabezado = ['Lote', 'Fecha de producción', 'Producto', 'Presentación', 'Unidades', 'Kg', 'Cliente', 'País', 'Destino',
    'Misión', 'Pedido', 'Factura', 'Placa', 'Transportista', 'Salida de fábrica', 'Entrega', 'Etapa'];
  const lineas = filas.map((f) => [
    f.lote, f.fecha_produccion, f.producto, nombrePresentacion(f.presentacion), f.unidades,
    Number(f.kg).toLocaleString('es-BO', { maximumFractionDigits: 1 }), f.cliente, f.pais_cliente, f.destino,
    f.mision, f.pedido, f.factura, f.placa, f.transportista, f.salida ? formatoHora(f.salida) : '', f.entrega ? formatoHora(f.entrega) : '',
    ETIQUETA_ETAPA[f.etapa as Etapa] ?? f.etapa,
  ].map(celda).join(';'));

  const fecha = new Date().toISOString().slice(0, 10);
  const nombre = q.toUpperCase().replace(/[^A-Z0-9-]/g, '');
  return new Response('﻿' + [encabezado.join(';'), ...lineas].join('\r\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="lote-${nombre}-${fecha}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
