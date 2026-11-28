/** Tipos de documento (enum tipo_documento) con el nombre que ve el usuario. */
export const TIPO_DOCUMENTO: Record<string, string> = {
  factura: 'Factura',
  guia: 'Guía',
  dex: 'DEX',
  crt: 'CRT',
  mic_dta: 'MIC/DTA',
  certificado_origen: 'Certificado de origen',
  otro: 'Foto u otro',
};

/** Documentos que debe llevar un camión que cruza a Perú. */
export const DOCUMENTOS_CRUCE = ['crt', 'mic_dta'] as const;

export interface DocumentoVigente {
  id: string;
  tipo: string;
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
