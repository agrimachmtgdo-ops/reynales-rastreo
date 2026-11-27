'use client';
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { formatoHora } from '@/lib/tipos';

interface Props {
  nombreChofer: string;
  telefonoChofer: string | null;
  codigoMision: string;
  generar: () => Promise<{ ok: true; codigo: string; venceEn: string } | { ok: false; mensaje: string }>;
  /** Invitación vigente guardada (si ya se generó antes). */
  vigente?: { codigo: string; vence_en: string; usado_en: string | null } | null;
}

const enlaceQr = (codigo: string) => QRCode.toDataURL(`reynaleschofer://activar?codigo=${codigo}`, { width: 220, margin: 1 });

/**
 * Genera el código de activación, muestra el QR (para imprimir en la guía)
 * y prepara el mensaje de WhatsApp para el chofer.
 */
export default function InvitacionChofer({ nombreChofer, telefonoChofer, codigoMision, generar, vigente }: Props) {
  const [codigo, setCodigo] = useState<string | null>(vigente?.codigo ?? null);
  const [vence, setVence] = useState<string | null>(vigente?.vence_en ?? null);
  const [activadaEn, setActivadaEn] = useState<string | null>(vigente?.usado_en ?? null);
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    if (vigente?.codigo) void enlaceQr(vigente.codigo).then(setQr);
  }, [vigente?.codigo]);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function crear() {
    if (codigo && !confirmarReemplazo()) return;
    setCargando(true);
    setError(null);
    const r = await generar();
    setCargando(false);
    if (!r.ok) {
      setError(r.mensaje);
      return;
    }
    setCodigo(r.codigo);
    setVence(r.venceEn);
    setActivadaEn(null);
    // El QR lleva un enlace que la app del chofer reconoce al escanearlo.
    setQr(await enlaceQr(r.codigo));
  }

  function confirmarReemplazo() {
    return window.confirm(
      activadaEn
        ? 'El chofer ya activó el viaje en su teléfono. Un código nuevo solo sirve si cambió de teléfono. ¿Continuar?'
        : 'Se anulará el código anterior. ¿Continuar?',
    );
  }

  const enlaceApp = process.env.NEXT_PUBLIC_ENLACE_APP_CHOFER ?? '';
  const mensaje = codigo
    ? `Hola ${nombreChofer}, le saluda despacho de Industrias Reynales. Para la misión ${codigoMision} instale la app de rastreo${
        enlaceApp ? ` (${enlaceApp})` : ''
      } y escriba este código: ${codigo}. El código vence el ${formatoHora(vence)}. La app solo registra su ubicación entre "Iniciar viaje" y "Entregado".`
    : '';
  const numero = (telefonoChofer ?? '').replace(/[^0-9]/g, '');
  const enlaceWhatsapp = `https://wa.me/${numero}?text=${encodeURIComponent(mensaje)}`;

  return (
    <div>
      {error && <div className="mensaje-error">{error}</div>}
      {!codigo && (
        <button type="button" className="boton dorado" onClick={crear} disabled={cargando}>
          {cargando ? 'Generando…' : 'Invitar chofer (código y QR)'}
        </button>
      )}
      {codigo && (
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {qr && <img src={qr} alt={`QR del código ${codigo}`} width={140} height={140} />}
          <div>
            <div className="codigo-invitacion">{codigo}</div>
            {activadaEn ? (
              <div className="mensaje-ok" style={{ margin: '4px 0 0' }}>Activada en el teléfono del chofer: {formatoHora(activadaEn)}</div>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--gris)' }}>Pendiente de activar · vence: {formatoHora(vence)}</div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              {!activadaEn && <a className="boton" href={enlaceWhatsapp} target="_blank" rel="noreferrer">Enviar por WhatsApp</a>}
              <button type="button" className="boton secundario" onClick={crear}>Nuevo código</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
