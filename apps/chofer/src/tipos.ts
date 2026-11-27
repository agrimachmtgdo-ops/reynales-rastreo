import type { Etapa } from '@reynales/shared';

/** Resumen del viaje que devuelven activar_invitacion, mi_viaje y aceptar_politica. */
export interface Viaje {
  asignacion_id: string;
  mision_codigo: string;
  etapa: Etapa;
  origen: string;
  destino: string;
  destino_pais: 'BO' | 'PE';
  placa: string;
  conductor: string;
  telefono_coordinador: string | null;
  requiere_consentimiento: boolean;
  politica: { version: string; texto: string } | null;
}
