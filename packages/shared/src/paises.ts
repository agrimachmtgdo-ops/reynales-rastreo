/** Países de destino que acepta el sistema. «Internacional» = cualquier destino fuera de Bolivia. */
export const PAISES = { BO: 'Bolivia', PE: 'Perú', CL: 'Chile' } as const;
export type Pais = keyof typeof PAISES;
export const CODIGOS_PAIS = Object.keys(PAISES) as Pais[];

export function esPais(valor: unknown): valor is Pais {
  return typeof valor === 'string' && valor in PAISES;
}

/** Destino fuera de Bolivia: pasa por frontera y exige DEX (y CRT/MIC en el tramo 2). */
export function esInternacional(pais: string | null | undefined): boolean {
  return !!pais && pais !== 'BO';
}

export function nombrePais(pais: string | null | undefined): string {
  return esPais(pais) ? PAISES[pais] : (pais ?? '');
}

/** Zona horaria con que se muestran las horas al cliente según el país de destino. */
export function nombreZonaHoraria(zona: string | null | undefined): string {
  if (zona === 'America/Lima') return 'hora de Perú';
  if (zona === 'America/Santiago') return 'hora de Chile';
  return 'hora de Bolivia';
}
