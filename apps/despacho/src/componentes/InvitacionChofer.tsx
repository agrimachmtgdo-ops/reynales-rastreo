'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import QRCode from 'qrcode';
import { enlaceWhatsApp, formatoHora } from '@/lib/tipos';

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
    ? [
        `Hola ${nombreChofer}, le saluda despacho de Industrias Reynales.`,
        `Para la misión ${codigoMision}:`,
        enlaceApp
          ? `1) Instale la app de rastreo desde este enlace: ${enlaceApp}`
          : '1) Instale la app de rastreo que le enviaremos (archivo APK).',
        '   Si el teléfono dice "bloqueado por seguridad", toque Configuración y active "Permitir de esta fuente". Si aparece Play Protect, toque "Instalar de todas formas".',
        `2) Abra la app y escriba este código: ${codigo} (vence el ${formatoHora(vence)}).`,
        '3) Permita la ubicación "Todo el tiempo" y quite el ahorro de batería para la app.',
        'La app solo registra su ubicación entre "Iniciar viaje" y "Entregado". Ante cualquier duda, responda a este mensaje.',
      ].join('\n')
    : '';
  // Solo con código de país (+591 / +51): un wa.me sin él abre el chat equivocado.
  const enlaceWhatsapp = mensaje ? enlaceWhatsApp(telefonoChofer, mensaje) : null;
  const [copiado, setCopiado] = useState(false);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(mensaje);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      window.prompt('Copie el mensaje:', mensaje);
    }
  }

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
              {!activadaEn && enlaceWhatsapp && <a className="boton" href={enlaceWhatsapp} target="_blank" rel="noreferrer">Enviar por WhatsApp</a>}
              {!activadaEn && (
                <button type="button" className="boton secundario" onClick={copiar}>{copiado ? 'Mensaje copiado ✓' : 'Copiar mensaje'}</button>
              )}
              <button type="button" className="boton secundario" onClick={crear}>Nuevo código</button>
            </div>
            {!activadaEn && !enlaceWhatsapp && (
              <p className="alerta" style={{ marginTop: 8 }}>
                Este chofer no tiene WhatsApp registrado (o le falta el código de país). Agréguelo en <Link href="/catalogos?pestana=conductores">Catálogos → Choferes</Link> o use «Copiar mensaje».
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
