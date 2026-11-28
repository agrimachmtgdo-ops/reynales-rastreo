/** Programa de despachos y requerimiento de camiones: tipos, semáforo y textos. */
import { formatoFecha, formatoToneladas, plural } from './pedidos';

export interface FilaPrograma {
  envio_id: string;
  numero: number;
  estado: string;
  toneladas: number;
  fecha_carga: string | null;
  entrega_vigente: string;
  entrega_comprometida: string | null;
  presentacion: string | null;
  embarque_fecha: string | null;
  pedido_id: string;
  pedido_codigo: string;
  orden_compra: string | null;
  producto: string;
  incoterm: string;
  cliente: string;
  destino: string;
  destino_pais: string;
  camiones_necesarios: number;
  camiones_pedidos: number;
  camiones_confirmados: number;
  camiones_asignados: number;
  camiones_en_fabrica: number;
  camiones_ausentes: number;
  mision_id: string | null;
  mision_codigo: string | null;
  mision_etapa: string | null;
  costo: Record<string, number> | null;
}

export interface Solicitud {
  id: string;
  transportista_id: string;
  camiones_pedidos: number;
  camiones_confirmados: number | null;
  presentacion: string | null;
  tarifa: number | null;
  tarifa_tipo: 'viaje' | 'tonelada';
  moneda: 'BOB' | 'USD';
  estado: 'pedido' | 'confirmado' | 'rechazado' | 'anulado';
  nota: string | null;
  creado_en: string;
  respondido_en: string | null;
  transportista: { razon_social: string; telefono: string | null; contacto: string | null } | null;
}

export const ESTADO_SOLICITUD: Record<string, string> = {
  pedido: 'Esperando respuesta',
  confirmado: 'Confirmó',
  rechazado: 'Rechazó',
  anulado: 'Anulado',
};

export type Semaforo = 'listo' | 'rojo' | 'amarillo' | 'a_tiempo' | 'en_curso';
export const NOMBRE_SEMAFORO: Record<Semaforo, string> = {
  listo: 'Camiones completos',
  rojo: 'Urgente: faltan camiones',
  amarillo: 'Pedir camiones ya',
  a_tiempo: 'A tiempo',
  en_curso: 'Despachado',
};

/** Días entre dos fechas AAAA-MM-DD (b − a). */
export function diasEntre(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** Fecha de carga del envío: la planificada o, si no hay, la de entrega. */
export const fechaCarga = (f: Pick<FilaPrograma, 'fecha_carga' | 'entrega_vigente'>) => f.fecha_carga ?? f.entrega_vigente;

/**
 * Semáforo del envío: rojo si faltan camiones confirmados a 2 días o menos de la carga;
 * amarillo si faltan dentro de los días de anticipación; verde si están completos.
 */
export function semaforo(f: FilaPrograma, hoy: string, diasAnticipacion: number): Semaforo {
  if (f.estado === 'en_curso' || f.estado === 'cumplido') return 'en_curso';
  if (f.camiones_confirmados >= f.camiones_necesarios) return 'listo';
  const dias = diasEntre(hoy, fechaCarga(f));
  if (dias <= 2) return 'rojo';
  if (dias <= diasAnticipacion) return 'amarillo';
  return 'a_tiempo';
}

/** Hora «07:30» en Bolivia de una marca de tiempo. */
export function horaBolivia(ts: string | null | undefined): string {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString('es-BO', { timeZone: 'America/La_Paz', hour: '2-digit', minute: '2-digit', hour12: false });
}
/** Fecha y hora en Bolivia para un campo datetime-local («2026-12-07T07:30»). */
export function valorFechaHora(ts: string | null | undefined): string {
  if (!ts) return '';
  const d = new Date(new Date(ts).getTime() - 4 * 3_600_000); // Bolivia, UTC−4 sin horario de verano
  return d.toISOString().slice(0, 16);
}
export function fechaHoraBolivia(ts: string | null | undefined): string {
  if (!ts) return '—';
  return `${formatoFecha(valorFechaHora(ts).slice(0, 10))} ${horaBolivia(ts)}`;
}

export function formatoDinero(monto: number, moneda: string): string {
  return `${moneda === 'USD' ? 'US$' : 'Bs'} ${monto.toLocaleString('es-BO', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}
export function formatoCosto(costo: Record<string, number> | null): string {
  if (!costo || Object.keys(costo).length === 0) return '—';
  return Object.entries(costo).map(([m, v]) => formatoDinero(Number(v), m)).join(' + ');
}
export function formatoTarifa(s: Pick<Solicitud, 'tarifa' | 'tarifa_tipo' | 'moneda'>): string {
  if (s.tarifa == null) return 'Sin tarifa';
  return `${formatoDinero(Number(s.tarifa), s.moneda)} por ${s.tarifa_tipo === 'viaje' ? 'viaje' : 'tonelada'}`;
}

/** Mensaje para copiar y enviar por WhatsApp al transportista. */
export function textoWhatsApp(f: FilaPrograma, s: Pick<Solicitud, 'camiones_pedidos' | 'presentacion' | 'tarifa' | 'tarifa_tipo' | 'moneda'>, origen: string | null): string {
  const presentacion = s.presentacion ?? f.presentacion;
  const lineas = [
    'Buen día. Industrias Reynales solicita camiones:',
    `• ${plural(s.camiones_pedidos, 'camión', 'camiones')} para ${f.producto} (${formatoToneladas(Number(f.toneladas))} en total).`,
    `• Carga en ${origen ?? 'fábrica'} el ${formatoFecha(fechaCarga(f))}${presentacion ? `, presentarse a las ${horaBolivia(presentacion)}` : ''}.`,
    `• Destino: ${f.destino} (${f.destino_pais}), entrega hasta el ${formatoFecha(f.entrega_vigente)}.`,
  ];
  if (s.tarifa != null) lineas.push(`• Tarifa: ${formatoTarifa(s)}.`);
  lineas.push('Por favor confirme cuántos camiones puede enviar y mande placa, nombre, CI y celular de cada chofer.');
  return lineas.join('\n');
}
