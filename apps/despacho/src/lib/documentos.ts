import { esInternacional } from '@reynales/shared';
/** Tipos de documento (enum tipo_documento) con el nombre que ve el usuario. */
export const TIPO_DOCUMENTO: Record<string, string> = {
  factura: 'Factura',
  guia: 'Guía',
  dex: 'DEX',
  crt: 'CRT',
  mic_dta: 'MIC/DTA',
  certificado_origen: 'Certificado de origen',
  otro: 'Foto u otro',
  lista_empaque: 'Lista de empaque',
  fitosanitario: 'Certificado fitosanitario',
  certificado_analisis: 'Certificado de análisis',
  ticket_balanza: 'Ticket de balanza',
  guia_firmada: 'Guía firmada (entrega)',
  booking: 'Booking',
  bl: 'BL (conocimiento de embarque)',
};

/** Claves que se guardan como tipo «otro» con etiqueta (el enum tipo_documento no se toca). */
export const ETIQUETAS_DOCUMENTO = [
  'lista_empaque', 'fitosanitario', 'certificado_analisis', 'ticket_balanza', 'guia_firmada', 'booking', 'bl',
] as const;
const esEtiqueta = (clave: string) => (ETIQUETAS_DOCUMENTO as readonly string[]).includes(clave);

/**
 * Clave que ve el usuario: un tipo del enum o una etiqueta (lista de empaque, fitosanitario…),
 * que en la base de datos se guarda como tipo «otro» con esa etiqueta.
 */
export type ClaveDocumento =
  | 'factura' | 'dex' | 'guia' | 'lista_empaque' | 'certificado_origen' | 'crt' | 'mic_dta' | 'otro'
  | 'fitosanitario' | 'certificado_analisis' | 'ticket_balanza' | 'guia_firmada' | 'booking' | 'bl';

/** Tipos que despacho puede subir, en el orden en que se ofrecen. */
export const CLAVES_DESPACHO: ClaveDocumento[] = [
  'factura', 'dex', 'guia', 'lista_empaque', 'certificado_origen', 'fitosanitario', 'certificado_analisis', 'ticket_balanza',
  'crt', 'mic_dta', 'guia_firmada', 'booking', 'bl', 'otro',
];

/** Documentos que debe llevar un camión que cruza la frontera (Perú o Chile). */
export const DOCUMENTOS_CRUCE = ['crt', 'mic_dta'] as const;

/** Tipos que piden número obligatorio al subirlos. */
export const PIDEN_NUMERO: ClaveDocumento[] = ['crt', 'mic_dta'];

export const claveDe = (tipo: string, etiqueta?: string | null): string =>
  tipo === 'otro' && etiqueta && esEtiqueta(etiqueta) ? etiqueta : tipo;

export const tipoYEtiqueta = (clave: string): { tipo: string; etiqueta: string | null } =>
  esEtiqueta(clave) ? { tipo: 'otro', etiqueta: clave } : { tipo: clave, etiqueta: null };

export const nombreDocumento = (tipo: string, etiqueta?: string | null) => {
  const clave = claveDe(tipo, etiqueta);
  return TIPO_DOCUMENTO[clave] ?? clave;
};

export interface DocumentoVigente {
  id: string;
  tipo: string;
  etiqueta?: string | null;
  numero: string | null;
  nombre: string | null;
  ruta: string;
  asignacion_id: string | null;
  placa: string | null;
  tipo_mime: string | null;
  creado_en: string;
  subido_por: string | null;
}

/** Datos que la página envía al servidor después de subir el archivo. */
export interface DatosDocumento {
  tipo: string;
  etiqueta?: string | null;
  numero: string | null;
  ruta: string;
  nombre: string;
  asignacionId: string | null;
  tipoMime: string;
  tamano: number;
  reemplaza: string | null;
}

/** ¿El camión tiene CRT y MIC/DTA vigentes (propios o de toda la misión)? Devuelve los que faltan. */
export function documentosFaltantes(documentos: DocumentoVigente[], asignacionId: string): string[] {
  return DOCUMENTOS_CRUCE.filter(
    (t) => !documentos.some((d) => d.tipo === t && (d.asignacion_id === asignacionId || d.asignacion_id === null)),
  );
}

/**
 * Documentos que se revisan al salir de fábrica: factura siempre y DEX si sale de Bolivia (Perú o Chile).
 * La lista de empaque se muestra como opcional.
 */
export function documentosRequeridos(pais: string | null | undefined): { clave: ClaveDocumento; obligatorio: boolean }[] {
  return [
    { clave: 'factura', obligatorio: true },
    ...(esInternacional(pais) ? [{ clave: 'dex' as const, obligatorio: true }] : []),
    { clave: 'lista_empaque', obligatorio: false },
  ];
}

/** Estado de cada documento requerido según los documentos (o las claves) que ya hay. */
export function estadoDocumentos(claves: string[], pais: string | null | undefined) {
  return documentosRequeridos(pais).map((r) => ({
    ...r,
    nombre: TIPO_DOCUMENTO[r.clave]!,
    tiene: claves.includes(r.clave),
  }));
}

/** ¿Están todos los obligatorios? */
export const documentosCompletos = (claves: string[], pais: string | null | undefined) =>
  estadoDocumentos(claves, pais).every((e) => !e.obligatorio || e.tiene);

const PISTAS: [RegExp, ClaveDocumento][] = [
  [/fito|senasag|phyto/i, 'fitosanitario'],
  [/an[aá]lisis|laboratorio|\bcoa\b|calidad/i, 'certificado_analisis'],
  [/ticket|balanza|pesaje/i, 'ticket_balanza'],
  [/gu[ií]a[\s_-]*firmada|recepci[oó]n|entrega[\s_-]*firmada/i, 'guia_firmada'],
  [/booking|reserva/i, 'booking'],
  [/\bb\/?l\b|bill[\s_-]*of[\s_-]*lading|conocimiento/i, 'bl'],
  [/lista[\s_-]*(de[\s_-]*)?empaque|packing|empaque/i, 'lista_empaque'],
  [/certificado|origen/i, 'certificado_origen'],
  [/\bmic\b|mic[\s_-]*dta|manifiesto/i, 'mic_dta'],
  [/\bcrt\b|carta[\s_-]*de[\s_-]*porte/i, 'crt'],
  [/\bdex\b|dex[\s_-]|duim|exportaci[oó]n/i, 'dex'],
  [/gu[ií]a|remisi[oó]n/i, 'guia'],
  [/factura|fact\b|fac[\s_-]/i, 'factura'],
];

/**
 * Sugiere el tipo y el número a partir del nombre del archivo
 * (ej. «factura_001-2345.pdf» → Factura, n.º 001-2345). La persona siempre confirma.
 */
export function sugerirDesdeNombre(nombreArchivo: string): { clave: ClaveDocumento; numero: string } {
  const base = nombreArchivo.replace(/\.[a-z0-9]{2,4}$/i, '');
  const clave = PISTAS.find(([re]) => re.test(base))?.[1] ?? 'otro';
  const numero = clave === 'otro' ? '' : (base.match(/\d[\d\-/.]{1,}\d/)?.[0] ?? '');
  return { clave, numero };
}

// ---------------------------------------------------------------------------
// Requisitos por cliente y destino (entrega 3)
// ---------------------------------------------------------------------------
export type Momento = 'salida_fabrica' | 'salida_transbordo' | 'entrega' | 'embarque';

export const NOMBRE_MOMENTO: Record<Momento, string> = {
  salida_fabrica: 'Salida de fábrica',
  salida_transbordo: 'Salida del transbordo',
  entrega: 'Entrega',
  embarque: 'Embarque',
};

/** Momento en que se pide cada documento (igual que momento_documento() en la base). */
export function momentoDocumento(clave: string): Momento {
  if (clave === 'crt' || clave === 'mic_dta') return 'salida_transbordo';
  if (clave === 'guia_firmada') return 'entrega';
  if (clave === 'booking' || clave === 'bl') return 'embarque';
  return 'salida_fabrica';
}

/** Documentos que se pueden exigir (todo menos «Foto u otro»). */
export const CLAVES_REQUISITO: ClaveDocumento[] = CLAVES_DESPACHO.filter((c) => c !== 'otro');

/** Una línea del expediente de la misión (expediente_mision). */
export interface ItemExpediente {
  documento: string;
  momento: Momento;
  asignacion_id: string | null;
  placa: string | null;
  tiene: boolean;
}

export const ALCANCE_REQUISITO: Record<string, string> = {
  todos: 'Todos los envíos',
  internacional: 'Envíos fuera de Bolivia',
  pais: 'Destino',
  cliente: 'Cliente',
};
