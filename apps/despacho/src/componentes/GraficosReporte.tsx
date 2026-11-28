/**
 * Gráficos del reporte, dibujados en SVG en el servidor (sin librerías).
 * Reglas: una sola escala por gráfico, marcas finas con punta redondeada, rejilla tenue,
 * etiquetas directas, el dato exacto al pasar el mouse (title) y siempre una tabla debajo.
 * Colores de marca validados: verde #00963F y dorado #E2A900 (el dorado lleva siempre su
 * valor escrito, porque tiene poco contraste sobre blanco); el café no se usa como serie.
 */
import { formatoHoras } from '@/lib/reportes';

export const COLOR_SERIE = ['#00963F', '#E2A900', '#3A7BD5'] as const;

function escalaMaxima(maximo: number): { tope: number; marcas: number[] } {
  if (maximo <= 0) return { tope: 1, marcas: [0, 1] };
  const paso = 10 ** Math.floor(Math.log10(maximo));
  const tope = [1, 2, 2.5, 5, 10].map((m) => m * paso).find((t) => t >= maximo) ?? maximo;
  const n = tope / paso <= 2.5 ? 5 : 4;
  return { tope, marcas: Array.from({ length: n + 1 }, (_, i) => (tope / n) * i) };
}

const numero = (n: number) => n.toLocaleString('es-BO', { maximumFractionDigits: 1 });

/** Columnas verticales (ej. entregas por semana). */
export function GraficoColumnas({
  titulo, datos, unidad,
}: { titulo: string; datos: { etiqueta: string; valor: number; detalle?: string }[]; unidad: string }) {
  const ancho = 640, alto = 220, izq = 36, abajo = 28, arriba = 18;
  const { tope, marcas } = escalaMaxima(Math.max(0, ...datos.map((d) => d.valor)));
  const anchoBanda = (ancho - izq) / Math.max(1, datos.length);
  const barra = Math.min(36, anchoBanda * 0.6);
  const y = (v: number) => arriba + (alto - arriba - abajo) * (1 - v / tope);
  const mayor = Math.max(...datos.map((d) => d.valor));
  return (
    <figure className="grafico">
      <figcaption>{titulo}</figcaption>
      <svg viewBox={`0 0 ${ancho} ${alto}`} role="img" aria-label={`${titulo}. El detalle está en la tabla.`}>
        {marcas.map((m) => (
          <g key={m}>
            <line x1={izq} x2={ancho} y1={y(m)} y2={y(m)} className="rejilla-grafico" />
            <text x={izq - 6} y={y(m) + 4} textAnchor="end" className="eje">{numero(m)}</text>
          </g>
        ))}
        {datos.map((d, i) => {
          const x = izq + anchoBanda * i + (anchoBanda - barra) / 2;
          const h = Math.max(0, y(0) - y(d.valor));
          return (
            <g key={d.etiqueta} className="marca">
              <rect x={izq + anchoBanda * i} y={arriba} width={anchoBanda} height={alto - arriba - abajo} fill="transparent" />
              {h >= 4 ? <path d={`M${x},${y(0)} v${-(h - 4)} q0,-4 4,-4 h${barra - 8} q4,0 4,4 v${h - 4} z`} fill={COLOR_SERIE[0]} />
                : h > 0 && <rect x={x} y={y(d.valor)} width={barra} height={h} fill={COLOR_SERIE[0]} />}
              {d.valor > 0 && (d.valor === mayor || datos.length <= 6) && (
                <text x={x + barra / 2} y={y(d.valor) - 5} textAnchor="middle" className="valor">{numero(d.valor)}</text>
              )}
              <text x={x + barra / 2} y={alto - 10} textAnchor="middle" className="eje">{d.etiqueta}</text>
              <title>{`${d.etiqueta}: ${numero(d.valor)} ${unidad}${d.detalle ? ` · ${d.detalle}` : ''}`}</title>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

/** Barras horizontales ordenadas (ej. toneladas por cliente). */
export function GraficoBarras({
  titulo, datos, unidad,
}: { titulo: string; datos: { etiqueta: string; valor: number; detalle?: string }[]; unidad: string }) {
  const fila = 30, izq = 170, ancho = 640, der = 70;
  const alto = Math.max(1, datos.length) * fila + 8;
  const tope = Math.max(1, ...datos.map((d) => d.valor));
  const largo = (v: number) => ((ancho - izq - der) * v) / tope;
  return (
    <figure className="grafico">
      <figcaption>{titulo}</figcaption>
      <svg viewBox={`0 0 ${ancho} ${alto}`} role="img" aria-label={`${titulo}. El detalle está en la tabla.`}>
        <line x1={izq} x2={izq} y1={0} y2={alto} className="rejilla-grafico" />
        {datos.map((d, i) => {
          const w = largo(d.valor);
          const yy = i * fila + 8;
          return (
            <g key={d.etiqueta} className="marca">
              <rect x={0} y={yy - 4} width={ancho} height={fila} fill="transparent" />
              <text x={izq - 8} y={yy + 13} textAnchor="end" className="eje-nombre">
                {d.etiqueta.length > 24 ? `${d.etiqueta.slice(0, 23)}…` : d.etiqueta}
              </text>
              {w > 0 && <path d={`M${izq},${yy + 3} h${Math.max(0, w - 4)} q4,0 4,4 v8 q0,4 -4,4 h${-Math.max(0, w - 4)} z`} fill={COLOR_SERIE[0]} />}
              <text x={izq + w + 6} y={yy + 13} className="valor">{numero(d.valor)} {unidad}</text>
              <title>{`${d.etiqueta}: ${numero(d.valor)} ${unidad}${d.detalle ? ` · ${d.detalle}` : ''}`}</title>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

/** Barra dividida: mediana de cada parte del viaje con transbordo, con leyenda y etiquetas. */
export function BarraPartes({ titulo, partes }: { titulo: string; partes: { nombre: string; horas: number | null }[] }) {
  const total = partes.reduce((s, p) => s + (p.horas ?? 0), 0);
  if (total <= 0) return <figure className="grafico"><figcaption>{titulo}</figcaption><p className="ayuda">Sin viajes con transbordo en el período.</p></figure>;
  const ancho = 640, alto = 34;
  let x = 0;
  return (
    <figure className="grafico">
      <figcaption>{titulo}</figcaption>
      <svg viewBox={`0 0 ${ancho} ${alto}`} role="img" aria-label={`${titulo}: ${partes.map((p) => `${p.nombre} ${formatoHoras(p.horas)}`).join(', ')}`}>
        {partes.map((p, i) => {
          const w = ((p.horas ?? 0) / total) * ancho;
          const segmento = (
            <g key={p.nombre} className="marca">
              <rect x={x} y={4} width={Math.max(0, w - 2)} height={26} rx={i === 0 || i === partes.length - 1 ? 4 : 0} fill={COLOR_SERIE[i]} />
              {w > 70 && <text x={x + w / 2} y={22} textAnchor="middle" className={i === 1 ? 'valor-sobre-claro' : 'valor-sobre-oscuro'}>{formatoHoras(p.horas)}</text>}
              <title>{`${p.nombre}: ${formatoHoras(p.horas)} (mediana)`}</title>
            </g>
          );
          x += w;
          return segmento;
        })}
      </svg>
      <ul className="leyenda-grafico">
        {partes.map((p, i) => (
          <li key={p.nombre}><span className="muestra" style={{ background: COLOR_SERIE[i] }} aria-hidden="true" />{p.nombre}: <strong>{formatoHoras(p.horas)}</strong></li>
        ))}
      </ul>
    </figure>
  );
}

/** Barra de avance contra una meta (ej. puntualidad 90 %). */
export function BarraMeta({ titulo, valor, meta, detalle }: { titulo: string; valor: number | null; meta: number; detalle: string }) {
  const ancho = 640, alto = 40;
  return (
    <figure className="grafico">
      <figcaption>{titulo}</figcaption>
      {valor === null ? <p className="ayuda">{detalle}</p> : (
        <>
          <p style={{ margin: '0 0 6px' }}>
            <strong className="numero-meta">{Math.round(valor * 100)} %</strong> a tiempo · meta {Math.round(meta * 100)} %{' '}
            {valor >= meta ? '✓ cumple' : '✗ por debajo de la meta'} <span className="ayuda">({detalle})</span>
          </p>
          <svg viewBox={`0 0 ${ancho} ${alto}`} role="img" aria-label={`${titulo}: ${Math.round(valor * 100)} %, meta ${Math.round(meta * 100)} %`}>
            <rect x={0} y={10} width={ancho} height={16} rx={4} fill="#ece7de" />
            <rect x={0} y={10} width={Math.max(0, ancho * Math.min(1, valor))} height={16} rx={4} fill={COLOR_SERIE[0]}>
              <title>{`${Math.round(valor * 100)} % a tiempo`}</title>
            </rect>
            <line x1={ancho * meta} x2={ancho * meta} y1={4} y2={32} stroke="#2b1d10" strokeWidth={2} />
            <text x={ancho * meta} y={40} textAnchor="middle" className="eje">meta</text>
          </svg>
        </>
      )}
    </figure>
  );
}
