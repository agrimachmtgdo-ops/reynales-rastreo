import { cargarCumplimiento, cargarTransportistas } from '@/lib/cumplimientoServidor';
import { fichasCumplimiento, leerFiltrosCumplimiento, motivoFalla, textoCausa } from '@/lib/cumplimiento';
import { formatoFecha } from '@/lib/pedidos';

export const dynamic = 'force-dynamic';

// Excel en español usa ";" como separador; el BOM hace que lea bien las tildes.
const celda = (v: unknown) => {
  const t = v === null || v === undefined ? '' : String(v);
  return /[";\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
const num = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n).replace('.', ','));
const pct = (p: number | null) => (p === null ? '' : `${Math.round(p * 100)} %`);
const si = (b: boolean | null) => (b === null ? '' : b ? 'Sí' : 'No');

function csv(nombre: string, encabezado: string[], filas: unknown[][]) {
  const cuerpo = [encabezado.join(';'), ...filas.map((f) => f.map(celda).join(';'))].join('\r\n');
  return new Response('﻿' + cuerpo, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${nombre}"`,
      'Cache-Control': 'no-store',
    },
  });
}

/** Exporta la vista de cumplimiento (envíos o transportistas) con los mismos filtros de la página. */
export async function GET(peticion: Request) {
  const filtros = leerFiltrosCumplimiento(Object.fromEntries(new URL(peticion.url).searchParams.entries()));

  if (filtros.vista === 'transportistas') {
    const { lista, error } = await cargarTransportistas(filtros);
    if (error) return new Response(`No se pudo exportar: ${error}`, { status: 500 });
    return csv(`transportistas-${filtros.desde}-a-${filtros.hasta}.csv`,
      ['Transportista', 'Camiones pedidos', 'Respondidos', 'Confirmados', 'Confirmación', 'Sin respuesta', 'Con placa', 'Llegaron',
        'Presentación', 'Llegadas con hora', 'Puntuales', 'Puntualidad', 'Ausencias'],
      fichasCumplimiento(lista).map((t) => [
        t.transportista, t.pedidos, t.respondidos, t.confirmados, pct(t.pctConfirmacion), t.sin_respuesta, t.asignados, t.llegaron,
        pct(t.pctPresentacion), t.con_hora, t.puntuales, pct(t.pctPuntualidad), t.ausencias,
      ]));
  }

  const { datos, error } = await cargarCumplimiento(filtros);
  if (error || !datos) return new Response(`No se pudo exportar: ${error}`, { status: 500 });
  return csv(`cumplimiento-${filtros.desde}-a-${filtros.hasta}.csv`,
    ['Pedido', 'Envío', 'Cliente', 'Incoterm', 'Destino', 'Se mide', 'Fecha comprometida', 'Fecha real', 'Embarque', 'A tiempo',
      'Días de atraso', 'TN comprometidas', 'TN reales', 'Recepción confirmada', 'Completo', 'OTIF', 'Resultado', 'Causa', 'Misión'],
    datos.envios.map((e) => [
      e.pedido_codigo, e.numero, e.cliente, e.incoterm, e.destino, e.hito === 'carga' ? 'Carga' : 'Entrega',
      formatoFecha(e.comprometida), e.fecha_real ? formatoFecha(e.fecha_real) : '', e.embarque ? formatoFecha(e.embarque) : '',
      si(e.a_tiempo), e.dias_atraso, num(e.toneladas_comprometidas), num(e.toneladas_reales), e.recibido_confirmado === undefined ? '' : si(e.recibido_confirmado), si(e.completo), si(e.otif),
      e.otif ? 'A tiempo y completo' : motivoFalla(e), e.otif ? '' : textoCausa(e.causa), e.mision_codigo,
    ]));
}
