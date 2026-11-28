/** Columnas que usa el tablero en vivo (con datos relacionados). */
export const SELECT_ASIGNACION_EN_VIVO = `
  id, mision_id, etapa, ultima_lat, ultima_lon, ultima_velocidad_kmh, ultima_senal, toneladas_cargadas, tramo, toneladas_declaradas, emergencia_en, emergencia_motivo, detenido_desde,
  mision:misiones ( codigo, cliente:clientes ( razon_social ), destino:ubicaciones!misiones_destino_id_fkey ( nombre ) ),
  conductor:conductores ( id, nombre, telefono ),
  vehiculo:vehiculos ( placa )
`;
