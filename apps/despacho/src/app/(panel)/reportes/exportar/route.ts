import { cargarReporte } from '@/lib/reportesServidor';
import { leerFiltros, textoMotivo, tiempos } from '@/lib/reportes';
import { formatoHora } from '@/lib/tipos';

export const dynamic = 'force-dynamic';

// Excel en español usa ";" como separador; el BOM hace que lea bien las tildes.
const celda = (v: unknown) => {
  const t = v === null || v === undefined ? '' : String(v);
  return /[";\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
// Horas con coma decimal, para que Excel pueda sumarlas.
const horas = (h: number | null) => (h === null ? '' : h.toFixed(1).replace('.', ','));

/** Exporta el detalle del reporte con los mismos filtros de la página. */
export async function GET(peticion: Request) {
  const p = Object.fromEntries(new URL(peticion.url).searchParams.entries());
  const filtros = leerFiltros(p);
  const { filas, error } = await cargarReporte(filtros);
  if (error) return new Response(`No se pudo exportar: ${error}`, { status: 500 });

  const encabezado = [
    'Misión', 'Cliente', 'Producto', 'Destino', 'País', 'Factura', 'Salida de fábrica', 'Entrega', 'Duración (h)',
    'Transbordo', 'Tramo 1 (h)', 'Espera transbordo (h)', 'Último tramo (h)', 'Espera frontera (h)',
    'Toneladas', 'Placas', 'Transportistas', 'Documentos completos', 'Entrega comprometida', 'Retraso (h)',
    'Incidencias', 'Motivos', '% recorrido con señal',
  ];
  const lineas = filas.map((f) => {
    const t = tiempos(f);
    const minViaje = f.camiones.reduce((s, c) => s + (Number(c.minutos_viaje) || 0), 0);
    const minSin = f.camiones.reduce((s, c) => s + (Number(c.minutos_sin_senal) || 0), 0);
    return [
      f.codigo, f.cliente, f.producto ?? '', f.destino, f.pais, f.factura, formatoHora(f.salida), formatoHora(f.entrega), horas(t.viaje),
      f.transbordo ? 'Sí' : 'No', horas(t.tramo1), horas(t.esperaTransbordo), horas(t.tramoFinal), horas(t.frontera),
      f.toneladas === null ? '' : String(f.toneladas).replace('.', ','),
      f.camiones.map((c) => c.placa).join(' / '), [...new Set(f.camiones.map((c) => c.transportista))].join(' / '),
      f.docs_completos ? 'Sí' : 'No', formatoHora(f.entrega_comprometida), horas(t.retraso),
      f.incidencias, f.motivos.map(textoMotivo).join(' / '),
      minViaje > 0 ? `${Math.round((1 - minSin / minViaje) * 100)} %` : '',
    ].map(celda).join(';');
  });

  return new Response('﻿' + [encabezado.join(';'), ...lineas].join('\r\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="entregas-${filtros.desde}-a-${filtros.hasta}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
