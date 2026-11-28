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
};

/**
 * Clave que ve el usuario: un tipo del enum o «lista_empaque», que en la base de datos
 * se guarda como tipo «otro» con etiqueta «lista_empaque» (el enum no se toca).
 */
export type ClaveDocumento =
  | 'factura' | 'dex' | 'guia' | 'lista_empaque' | 'certificado_origen' | 'crt' | 'mic_dta' | 'otro';

/** Tipos que despacho puede subir, en el orden en que se ofrecen. */
export const CLAVES_DESPACHO: ClaveDocumento[] = ['factura', 'dex', 'guia', 'lista_empaque', 'certificado_origen', 'crt', 'mic_dta', 'otro'];

/** Documentos que debe llevar un camión que cruza a Perú. */
export const DOCUMENTOS_CRUCE = ['crt', 'mic_dta'] as const;

/** Tipos que piden número obligatorio al subirlos. */
export const PIDEN_NUMERO: ClaveDocumento[] = ['crt', 'mic_dta'];

export const claveDe = (tipo: string, etiqueta?: string | null): string =>
  tipo === 'otro' && etiqueta === 'lista_empaque' ? 'lista_empaque' : tipo;

export const tipoYEtiqueta = (clave: string): { tipo: string; etiqueta: string | null } =>
  clave === 'lista_empaque' ? { tipo: 'otro', etiqueta: 'lista_empaque' } : { tipo: clave, etiqueta: null };

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
 * Documentos que se revisan al salir de fábrica: factura siempre y DEX si va a Perú.
 * La lista de empaque se muestra como opcional.
 */
export function documentosRequeridos(pais: string | null | undefined): { clave: ClaveDocumento; obligatorio: boolean }[] {
  return [
    { clave: 'factura', obligatorio: true },
    ...(pais === 'PE' ? [{ clave: 'dex' as const, obligatorio: true }] : []),
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
