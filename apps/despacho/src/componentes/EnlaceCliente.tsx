'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { enlaceWhatsApp, formatoHora, haceCuanto } from '@/lib/tipos';

interface Props {
  codigoMision: string;
  nombreCliente: string | null;
  whatsappCliente: string | null;
  /** Enlace activo guardado (si ya se creó antes). */
  vigente: { token: string; creado_en: string; visitas?: number; ultima_visita?: string | null } | null;
  generar: () => Promise<{ ok: true; token: string } | { ok: false; mensaje: string }>;
  anular: () => Promise<{ ok: true } | { ok: false; mensaje: string }>;
}

/**
 * Enlace que despacho envía al cliente para que vea el avance de su carga sin iniciar sesión.
 * El cliente ve etapa, hitos y posición con 15 min de retraso; nunca los datos del chofer.
 */
export default function EnlaceCliente({ codigoMision, nombreCliente, whatsappCliente, vigente, generar, anular }: Props) {
  const [token, setToken] = useState<string | null>(vigente?.token ?? null);
  const [creado, setCreado] = useState<string | null>(vigente?.creado_en ?? null);
  const [origen, setOrigen] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [copiado, setCopiado] = useState(false);

  // La dirección del panel se toma del navegador (sirve igual en vista previa y en producción).
  useEffect(() => setOrigen(window.location.origin), []);

  const url = token && origen ? `${origen}/seguimiento/${token}` : '';
  const mensaje = url
    ? [
        `Estimado cliente${nombreCliente ? ` (${nombreCliente})` : ''}, le saluda Industrias Reynales.`,
        `Puede seguir el avance de su carga, misión ${codigoMision}, en este enlace:`,
        url,
        'La ubicación es aproximada y se muestra con 15 minutos de retraso. El enlace deja de funcionar 48 horas después de la entrega.',
      ].join('\n')
    : '';
  // Solo con código de país (Fase 1): sin él no se arma el enlace de WhatsApp.
  const enlaceWhatsapp = mensaje ? enlaceWhatsApp(whatsappCliente, mensaje) : null;
  const esVigente = token !== null && token === vigente?.token;

  async function crear() {
    if (token && !window.confirm('El enlace actual dejará de funcionar y deberá enviar el nuevo al cliente. ¿Continuar?')) return;
    setCargando(true);
    setError(null);
    const r = await generar();
    setCargando(false);
    if (!r.ok) return setError(r.mensaje);
    setToken(r.token);
    setCreado(new Date().toISOString());
  }

  async function quitar() {
    if (!window.confirm('El cliente ya no podrá ver el seguimiento con este enlace. ¿Anularlo?')) return;
    setCargando(true);
    setError(null);
    const r = await anular();
    setCargando(false);
    if (!r.ok) return setError(r.mensaje);
    setToken(null);
    setCreado(null);
  }

  async function copiar(texto: string) {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      window.prompt('Copie el texto:', texto);
    }
  }

  return (
    <div>
      {error && <div className="mensaje-error">{error}</div>}
      {!token ? (
        <>
          <p className="ayuda">
            El cliente verá las etapas, la ubicación aproximada de cada camión (15 min de retraso; si está parado, solo la zona),
            las toneladas y la llegada estimada. La placa, solo a menos de 50 km del destino. Nunca verá datos del chofer.
          </p>
          <button type="button" className="boton dorado" onClick={crear} disabled={cargando}>
            {cargando ? 'Creando…' : 'Crear enlace para el cliente'}
          </button>
        </>
      ) : (
        <>
          <input readOnly value={url} aria-label="Enlace de seguimiento" onFocus={(e) => e.currentTarget.select()} style={{ width: '100%' }} />
          <div style={{ fontSize: 13, color: 'var(--gris)', margin: '4px 0 8px' }}>
            Activo desde {formatoHora(creado)} · deja de funcionar 48 h después de la entrega
            <br />
            {esVigente && (vigente?.visitas ?? 0) > 0
              ? `Visto ${vigente!.visitas} ${vigente!.visitas === 1 ? 'vez' : 'veces'} · última ${haceCuanto(vigente!.ultima_visita ?? null)}`
              : 'El cliente todavía no lo abrió.'}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {enlaceWhatsapp && <a className="boton" href={enlaceWhatsapp} target="_blank" rel="noreferrer">Enviar por WhatsApp</a>}
            <button type="button" className="boton secundario" onClick={() => copiar(mensaje)} disabled={!url}>
              {copiado ? 'Copiado ✓' : 'Copiar mensaje'}
            </button>
            {url && <a className="boton secundario" href={url} target="_blank" rel="noreferrer">Ver como cliente</a>}
            <button type="button" className="boton secundario" onClick={crear} disabled={cargando}>Nuevo enlace</button>
            <button type="button" className="boton secundario" onClick={quitar} disabled={cargando}>Anular</button>
          </div>
          {!enlaceWhatsapp && (
            <p className="alerta" style={{ marginTop: 8 }}>
              El cliente no tiene WhatsApp registrado. Agréguelo en <Link href="/catalogos?pestana=clientes">Catálogos → Clientes</Link> o use «Copiar mensaje».
            </p>
          )}
        </>
      )}
    </div>
  );
}
