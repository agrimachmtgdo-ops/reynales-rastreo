/** Prueba de entrega (ola 1 · entrega 4): tipos y textos compartidos. */
export type Novedad = 'sin_novedad' | 'faltante' | 'dano' | 'humedad' | 'otra';

export const NOVEDAD: Record<Novedad, string> = {
  sin_novedad: 'Sin novedad',
  faltante: 'Faltante',
  dano: 'Daño',
  humedad: 'Humedad',
  otra: 'Otra',
};

const UNIDADES: Record<string, [string, string]> = {
  saco_50: ['saco de 50 kg', 'sacos de 50 kg'],
  saco_40: ['saco de 40 kg', 'sacos de 40 kg'],
  big_bag_1200: ['big bag', 'big bags'],
};

export const KG_UNIDAD: Record<string, number> = { saco_50: 50, saco_40: 40, big_bag_1200: 1200 };

export interface PruebaEntrega {
  id: string;
  asignacion_id: string;
  recibido_por: string;
  presentacion: string | null;
  unidades_recibidas: number | null;
  kg_recibidos: number;
  kg_despachados: number | null;
  novedad: Novedad;
  nota: string | null;
  foto_guia: string | null;
  sin_guia: boolean;
  fotos_novedad: string[];
  fotos_subidas: string[];
  hora_dispositivo: string | null;
  registrada_en: string;
  origen: 'chofer' | 'logistica';
  /** Enlaces temporales a las fotos ya subidas (mismo orden: guía y novedades). */
  enlaceGuia?: string | null;
  enlacesNovedad?: (string | null)[];
}

export const SELECT_PRUEBA = 'id, asignacion_id, recibido_por, presentacion, unidades_recibidas, kg_recibidos, kg_despachados, novedad, nota, foto_guia, sin_guia, fotos_novedad, fotos_subidas, hora_dispositivo, registrada_en, origen';

const miles = (n: number) => n.toLocaleString('es-BO', { maximumFractionDigits: 1 });

/** «570 sacos de 50 kg (28.500 kg)» o «28.500 kg». */
export function textoCantidad(presentacion: string | null, unidades: number | null, kg: number | null): string {
  const n = presentacion ? UNIDADES[presentacion] : undefined;
  const textoKg = kg != null ? `${miles(kg)} kg` : '—';
  return n && unidades != null ? `${miles(unidades)} ${unidades === 1 ? n[0] : n[1]} (${textoKg})` : textoKg;
}

/** Diferencia recibida − despachada en kg (negativa = faltante), o null si no hay peso de salida. */
export function diferenciaKg(p: Pick<PruebaEntrega, 'kg_recibidos' | 'kg_despachados'>): number | null {
  return p.kg_despachados == null ? null : Number(p.kg_recibidos) - Number(p.kg_despachados);
}
