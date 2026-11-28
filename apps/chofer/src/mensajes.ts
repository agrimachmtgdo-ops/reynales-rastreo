/** Traduce errores técnicos a frases simples para el chofer. */
export function mensajeSimple(err: unknown, porDefecto = 'No se pudo completar. Intente de nuevo.'): string {
  const texto =
    err instanceof Error
      ? err.message
      : typeof err === 'object' && err !== null && 'message' in err
        ? String((err as { message: unknown }).message)
        : String(err ?? '');
  if (/network|fetch|abort|timeout|timed out|conexi[oó]n/i.test(texto)) return 'No hay señal. Intente de nuevo cuando tenga cobertura.';
  if (/JWT|token|Sesi[oó]n no iniciada|session/i.test(texto)) return 'La sesión se cerró. Cierre la app, ábrala de nuevo e intente otra vez.';
  if (/Sin acceso/i.test(texto)) return 'Este teléfono perdió el acceso al viaje. Avise a despacho.';
  if (/No se puede pasar/i.test(texto)) return 'Esta etapa ya estaba registrada. La pantalla se actualizó.';
  if (/Debe aceptar la pol/i.test(texto)) return 'Primero debe aceptar las condiciones de rastreo.';
  // Mensajes técnicos (código, nombres de funciones): no se muestran al chofer.
  if (/PGRST|syntax|function|relation|column|violates|[a-z]+_[a-z]+\(/i.test(texto)) return porDefecto;
  return texto || porDefecto;
}
