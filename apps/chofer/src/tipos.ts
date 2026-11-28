import type { Etapa } from '@reynales/shared';

/** Resumen del viaje que devuelven activar_invitacion, mi_viaje y aceptar_politica. */
export interface Viaje {
  asignacion_id: string;
  mision_codigo: string;
  etapa: Etapa;
  origen: string;
  destino: string;
  destino_pais: 'BO' | 'PE';
  /** Tramo del viaje (1 = desde fábrica). Servidor con transbordo (2026-12). */
  tramo?: number;
  /** true si este camión termina en un transbordo y no en el destino final. */
  transbordo?: boolean;
  placa: string;
  conductor: string;
  telefono_coordinador: string | null;
  requiere_consentimiento: boolean;
  politica: { version: string; texto: string } | null;
}
