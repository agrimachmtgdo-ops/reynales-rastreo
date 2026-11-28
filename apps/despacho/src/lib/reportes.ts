import { esPais } from '@reynales/shared';
/**
 * Cálculos del reporte de entregas. La base de datos devuelve una fila por misión
 * (public.reporte_entregas); aquí se arman los números, gráficos y fichas.
 * Los tiempos usan la MEDIANA (el viaje típico) y el «peor 10 %», no el promedio:
 * un solo viaje trabado días en frontera no deforma el resultado.
 */

export interface CamionReporte {
  id: string;
  tramo: number;
  transportista_id: string;
  transportista: string;
  placa: string;
  chofer: string;
  toneladas: number | null;
  inicio: string | null;
  fin: string | null;
  minutos_viaje: number | null;
  minutos_sin_senal: number | null;
  etapas_chofer: number;
  etapas_sistema: number;
  etapas_despacho: number;
}

export interface FilaReporte {
  id: string;
  codigo: string;
  cliente_id: string;
  cliente: string;
  destino: string;
  pais: string;
  factura: string | null;
  salida: string | null;
  entrega: string;
  entrega_comprometida: string | null;
  transbordo: boolean;
  llegada_transbordo: string | null;
  salida_transbordo: string | null;
  llega_frontera: string | null;
  cruza_frontera: string | null;
  toneladas: number | null;
  docs_completos: boolean;
  incidencias: number;
  motivos: string[];
  camiones: CamionReporte[];
}

export interface FiltrosReporte {
  desde: string;
  hasta: string;
  cliente?: string;
  pais?: string;
  transportista?: string;
}

/** Meta de puntualidad (entregas a tiempo sobre las que tienen fecha comprometida). */
export const META_PUNTUALIDAD = 0.9;

const DIA = 86_400_000;
const fechaValida = (f?: string | null) => !!f && /^\d{4}-\d{2}-\d{2}$/.test(f) && !Number.isNaN(Date.parse(f));
const uuidValido = (v?: string | null) => !!v && /^[0-9a-f-]{36}$/i.test(v);

/** Fecha de hoy en Bolivia (UTC-4), como AAAA-MM-DD. */
export function hoyBolivia(ahora = new Date()): string {
  return new Date(ahora.getTime() - 4 * 3_600_000).toISOString().slice(0, 10);
}

const sumarDias = (f: string, dias: number) => new Date(Date.parse(`${f}T00:00:00Z`) + dias * DIA).toISOString().slice(0, 10);

/** Primer y último día del mes anterior (para «Reporte del mes»). */
export function mesAnterior(hoy = hoyBolivia()): { desde: string; hasta: string; nombre: string } {
  const [a, m] = hoy.split('-').map(Number) as [number, number];
  const inicio = new Date(Date.UTC(a, m - 2, 1));
  const fin = new Date(Date.UTC(a, m - 1, 0));
  const nombre = inicio.toLocaleDateString('es-BO', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return { desde: inicio.toISOString().slice(0, 10), hasta: fin.toISOString().slice(0, 10), nombre };
}

/** Lee los filtros de la dirección de la página; por defecto, los últimos 30 días. */
export function leerFiltros(p: Record<string, string | string[] | undefined>): FiltrosReporte {
  const t = (k: string) => (typeof p[k] === 'string' ? (p[k] as string) : undefined);
  const hoy = hoyBolivia();
  let desde = fechaValida(t('desde')) ? t('desde')! : sumarDias(hoy, -29);
  let hasta = fechaValida(t('hasta')) ? t('hasta')! : hoy;
  if (hasta < desde) [desde, hasta] = [hasta, desde];
  if (Date.parse(hasta) - Date.parse(desde) > 400 * DIA) desde = sumarDias(hasta, -400);
  const pais = esPais(t('pais')) ? t('pais') : undefined;
  return {
    desde, hasta, pais,
    cliente: uuidValido(t('cliente')) ? t('cliente') : undefined,
    transportista: uuidValido(t('transportista')) ? t('transportista') : undefined,
  };
}

/** El período anterior del mismo largo (para comparar: «+12 % vs. período anterior»). */
export function periodoAnterior(f: FiltrosReporte): FiltrosReporte {
  const dias = Math.round((Date.parse(f.hasta) - Date.parse(f.desde)) / DIA) + 1;
  return { ...f, desde: sumarDias(f.desde, -dias), hasta: sumarDias(f.hasta, -dias) };
}

export const horasEntre = (a: string | null, b: string | null) =>
  a && b ? Math.max(0, (Date.parse(b) - Date.parse(a)) / 3_600_000) : null;

/** Percentil (0 a 1) con interpolación lineal. Devuelve null si no hay datos. */
export function percentil(valores: (number | null | undefined)[], p: number): number | null {
  const v = valores.filter((x): x is number => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const pos = (v.length - 1) * p;
  const base = Math.floor(pos);
  const resto = pos - base;
  return v[base + 1] !== undefined ? v[base]! + resto * (v[base + 1]! - v[base]!) : v[base]!;
}
export const mediana = (v: (number | null | undefined)[]) => percentil(v, 0.5);
/** «Peor 10 %»: el tiempo que superan solo los viajes más lentos (percentil 90). */
export const peor10 = (v: (number | null | undefined)[]) => percentil(v, 0.9);

export interface Tiempos {
  viaje: number | null;
  tramo1: number | null;
  esperaTransbordo: number | null;
  tramoFinal: number | null;
  frontera: number | null;
  retraso: number | null;
}

/** Tiempos (en horas) de una misión. Retraso: horas después de lo comprometido (0 = a tiempo). */
export function tiempos(f: FilaReporte): Tiempos {
  return {
    viaje: horasEntre(f.salida, f.entrega),
    tramo1: f.transbordo ? horasEntre(f.salida, f.llegada_transbordo) : null,
    esperaTransbordo: f.transbordo ? horasEntre(f.llegada_transbordo, f.salida_transbordo) : null,
    tramoFinal: f.transbordo ? horasEntre(f.salida_transbordo, f.entrega) : null,
    frontera: horasEntre(f.llega_frontera, f.cruza_frontera),
    retraso: f.entrega_comprometida ? Math.max(0, (Date.parse(f.entrega) - Date.parse(f.entrega_comprometida)) / 3_600_000) : null,
  };
}

export interface Resumen {
  entregas: number;
  toneladas: number;
  viajeMediana: number | null;
  viajePeor10: number | null;
  esperaTransbordoMediana: number | null;
  esperaTransbordoPeor10: number | null;
  fronteraMediana: number | null;
  fronteraPeor10: number | null;
  conIncidencias: number;
  docsCompletos: number;
  conCompromiso: number;
  aTiempo: number;
}

export function resumir(filas: FilaReporte[]): Resumen {
  const t = filas.map(tiempos);
  const conCompromiso = t.filter((x) => x.retraso !== null);
  return {
    entregas: filas.length,
    toneladas: filas.reduce((s, f) => s + (Number(f.toneladas) || 0), 0),
    viajeMediana: mediana(t.map((x) => x.viaje)),
    viajePeor10: peor10(t.map((x) => x.viaje)),
    esperaTransbordoMediana: mediana(t.map((x) => x.esperaTransbordo)),
    esperaTransbordoPeor10: peor10(t.map((x) => x.esperaTransbordo)),
    fronteraMediana: mediana(t.map((x) => x.frontera)),
    fronteraPeor10: peor10(t.map((x) => x.frontera)),
    conIncidencias: filas.filter((f) => f.incidencias > 0).length,
    docsCompletos: filas.filter((f) => f.docs_completos).length,
    conCompromiso: conCompromiso.length,
    aTiempo: conCompromiso.filter((x) => x.retraso === 0).length,
  };
}

/** Variación contra el período anterior, como texto: «+12 %», «−5 %» o null si no se puede comparar. */
export function variacion(actual: number | null, anterior: number | null): string | null {
  if (actual === null || anterior === null || anterior === 0) return null;
  const v = Math.round(((actual - anterior) / anterior) * 100);
  return `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v)} %`;
}

/** Lunes (AAAA-MM-DD, hora de Bolivia) de la semana de una fecha. */
export function lunesDe(iso: string): string {
  const d = new Date(Date.parse(iso) - 4 * 3_600_000);
  const dia = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dia)).toISOString().slice(0, 10);
}

/** Entregas por semana dentro del período (incluye semanas sin entregas). */
export function entregasPorSemana(filas: FilaReporte[], f: FiltrosReporte): { semana: string; entregas: number; toneladas: number }[] {
  const semanas: { semana: string; entregas: number; toneladas: number }[] = [];
  for (let s = lunesDe(`${f.desde}T12:00:00-04:00`); s <= f.hasta; s = sumarDias(s, 7)) semanas.push({ semana: s, entregas: 0, toneladas: 0 });
  for (const fila of filas) {
    const s = semanas.find((x) => x.semana === lunesDe(fila.entrega));
    if (s) {
      s.entregas++;
      s.toneladas += Number(fila.toneladas) || 0;
    }
  }
  return semanas;
}

/** Toneladas por cliente: los 8 principales y «Otros», de mayor a menor. */
export function toneladasPorCliente(filas: FilaReporte[], maximo = 8): { cliente: string; toneladas: number; entregas: number }[] {
  const mapa = new Map<string, { cliente: string; toneladas: number; entregas: number }>();
  for (const f of filas) {
    const c = mapa.get(f.cliente_id) ?? { cliente: f.cliente, toneladas: 0, entregas: 0 };
    c.toneladas += Number(f.toneladas) || 0;
    c.entregas++;
    mapa.set(f.cliente_id, c);
  }
  const lista = [...mapa.values()].sort((a, b) => b.toneladas - a.toneladas);
  if (lista.length <= maximo) return lista;
  const otros = lista.slice(maximo).reduce((o, c) => ({ cliente: 'Otros', toneladas: o.toneladas + c.toneladas, entregas: o.entregas + c.entregas }),
    { cliente: 'Otros', toneladas: 0, entregas: 0 });
  return [...lista.slice(0, maximo), otros];
}

/** Mediana de cada parte del viaje con transbordo (para la barra dividida). */
export function tiempoPorTramo(filas: FilaReporte[]) {
  const t = filas.filter((f) => f.transbordo).map(tiempos);
  return {
    viajes: t.length,
    partes: [
      { nombre: 'Fábrica → transbordo', horas: mediana(t.map((x) => x.tramo1)) },
      { nombre: 'Espera en el transbordo', horas: mediana(t.map((x) => x.esperaTransbordo)) },
      { nombre: 'Transbordo → destino', horas: mediana(t.map((x) => x.tramoFinal)) },
    ],
  };
}

export interface FichaTransportista {
  id: string;
  nombre: string;
  viajes: number;
  toneladas: number;
  duracionMediana: number | null;
  conIncidencias: number;
  pctSenal: number | null;
  horasSinSenal: number;
  viajesSenalBaja: number;
  etapasChofer: number;
  etapasSistema: number;
  etapasDespacho: number;
}

/** Umbral para «viaje con señal baja» (menos del 80 % del recorrido con señal). */
export const SENAL_MINIMA = 0.8;

/** Ficha por transportista: base para el incentivo y la penalidad. Un viaje = un camión en una misión. */
export function fichasTransportistas(filas: FilaReporte[]): FichaTransportista[] {
  const mapa = new Map<string, FichaTransportista & { minViaje: number; minSin: number; duraciones: number[]; misionesInc: Set<string> }>();
  for (const f of filas) {
    for (const c of f.camiones) {
      const x = mapa.get(c.transportista_id) ?? {
        id: c.transportista_id, nombre: c.transportista, viajes: 0, toneladas: 0, duracionMediana: null, conIncidencias: 0,
        pctSenal: null, horasSinSenal: 0, viajesSenalBaja: 0, etapasChofer: 0, etapasSistema: 0, etapasDespacho: 0,
        minViaje: 0, minSin: 0, duraciones: [], misionesInc: new Set<string>(),
      };
      x.viajes++;
      x.toneladas += Number(c.toneladas) || 0;
      if (c.minutos_viaje) {
        x.minViaje += Number(c.minutos_viaje);
        x.minSin += Number(c.minutos_sin_senal) || 0;
        x.duraciones.push(Number(c.minutos_viaje) / 60);
        if (1 - (Number(c.minutos_sin_senal) || 0) / Number(c.minutos_viaje) < SENAL_MINIMA) x.viajesSenalBaja++;
      }
      if (f.incidencias > 0) x.misionesInc.add(f.id);
      x.etapasChofer += c.etapas_chofer;
      x.etapasSistema += c.etapas_sistema;
      x.etapasDespacho += c.etapas_despacho;
      mapa.set(c.transportista_id, x);
    }
  }
  return [...mapa.values()].map(({ minViaje, minSin, duraciones, misionesInc, ...x }) => ({
    ...x,
    duracionMediana: mediana(duraciones),
    conIncidencias: misionesInc.size,
    pctSenal: minViaje > 0 ? 1 - minSin / minViaje : null,
    horasSinSenal: minSin / 60,
  })).sort((a, b) => b.viajes - a.viajes || a.nombre.localeCompare(b.nombre));
}

/** «2 d 5 h», «7 h 30 min» o «—». */
export function formatoHoras(h: number | null | undefined): string {
  if (h === null || h === undefined || !Number.isFinite(h)) return '—';
  if (h >= 48) return `${Math.floor(h / 24)} d ${Math.round(h % 24)} h`;
  if (h >= 1) {
    const min = Math.round((h % 1) * 60);
    return `${Math.floor(h)} h${min ? ` ${min} min` : ''}`;
  }
  return `${Math.round(h * 60)} min`;
}

export const formatoTn = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : Number(n).toLocaleString('es-BO', { maximumFractionDigits: 1 });

export const formatoPct = (p: number | null | undefined) => (p === null || p === undefined ? '—' : `${Math.round(p * 100)} %`);

const MOTIVOS: Record<string, string> = {
  emergencia: 'Emergencia',
  diferencia_peso_transbordo: 'Diferencia de peso en transbordo',
  sin_documentos_transbordo: 'Salió de El Alto sin CRT/MIC',
  sin_documentos_carga: 'Salió de fábrica sin factura/DEX',
  salto_ubicacion: 'Saltos de GPS',
  ubicacion_simulada: 'GPS simulado',
  inicio_lejos_de_origen: 'Inició lejos de fábrica',
};
export const textoMotivo = (m: string) => MOTIVOS[m] ?? m.replace(/_/g, ' ');

/** Parámetros de la dirección para unos filtros (para enlaces y exportar). */
export function aParametros(f: FiltrosReporte): string {
  const p = new URLSearchParams({ desde: f.desde, hasta: f.hasta });
  if (f.cliente) p.set('cliente', f.cliente);
  if (f.pais) p.set('pais', f.pais);
  if (f.transportista) p.set('transportista', f.transportista);
  return p.toString();
}
