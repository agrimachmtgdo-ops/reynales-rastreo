'use client';
import { crearClienteNavegador } from '@/lib/supabase/client';

/**
 * Sube un archivo al almacenamiento privado «documentos» informando el avance (0 a 100).
 * Usa la sesión de la persona: las reglas de la base de datos deciden si puede subirlo.
 */
export async function subirConAvance(
  ruta: string,
  blob: Blob,
  tipo: string,
  alAvanzar: (porcentaje: number) => void,
): Promise<void> {
  const { data } = await crearClienteNavegador().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Su sesión venció. Vuelva a ingresar e intente de nuevo.');
  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/documentos/${ruta.split('/').map(encodeURIComponent).join('/')}`;

  await new Promise<void>((resolver, rechazar) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('apikey', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    xhr.setRequestHeader('Content-Type', tipo);
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) alAvanzar(Math.min(99, Math.round((e.loaded / e.total) * 100)));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        alAvanzar(100);
        resolver();
        return;
      }
      let detalle = '';
      try {
        detalle = (JSON.parse(xhr.responseText) as { message?: string }).message ?? '';
      } catch {
        /* respuesta sin JSON */
      }
      rechazar(new Error(`No se pudo subir el archivo${detalle ? `: ${detalle}` : ''}.`));
    };
    xhr.onerror = () => rechazar(new Error('Se cortó la conexión al subir el archivo. Revise la señal e intente de nuevo.'));
    xhr.ontimeout = xhr.onerror;
    xhr.timeout = 5 * 60 * 1000;
    xhr.send(blob);
  });
}

export type EstadoSubida =
  | { fase: 'en_cola' }
  | { fase: 'preparando' }
  | { fase: 'subiendo'; avance: number }
  | { fase: 'guardando' }
  | { fase: 'listo'; mensaje: string }
  | { fase: 'error'; mensaje: string };

/** Texto corto de cada estado, para mostrar junto al documento. */
export function textoEstado(e: EstadoSubida): string {
  switch (e.fase) {
    case 'en_cola': return 'En cola';
    case 'preparando': return 'Preparando…';
    case 'subiendo': return `Subiendo ${e.avance} %`;
    case 'guardando': return 'Guardando…';
    case 'listo': return '✓ Guardado';
    case 'error': return `✗ ${e.mensaje}`;
  }
}

/**
 * Prepara (achica o une hojas), sube y registra un documento.
 * El nombre del archivo es aleatorio y va dentro de la carpeta de la misión.
 */
export async function subirDocumento(opciones: {
  misionId: string;
  archivos: File[];
  clave: string;
  numero: string | null;
  asignacionId?: string | null;
  reemplaza?: string | null;
  registrar: (datos: import('./documentos').DatosDocumento) => Promise<{ ok: boolean; mensaje: string }>;
  alCambiar: (e: EstadoSubida) => void;
}): Promise<boolean> {
  const { misionId, archivos, clave, numero, registrar, alCambiar } = opciones;
  const { prepararDocumento } = await import('./comprimir');
  const { tipoYEtiqueta } = await import('./documentos');
  try {
    alCambiar({ fase: 'preparando' });
    const listo = await prepararDocumento(archivos);
    const ruta = `${misionId}/${crypto.randomUUID()}.${listo.extension}`;
    alCambiar({ fase: 'subiendo', avance: 0 });
    await subirConAvance(ruta, listo.blob, listo.tipo, (avance) => alCambiar({ fase: 'subiendo', avance }));
    alCambiar({ fase: 'guardando' });
    const { tipo, etiqueta } = tipoYEtiqueta(clave);
    const primero = archivos[0]!;
    const nombre = archivos.length > 1 ? `${clave}-${archivos.length}-hojas.pdf` : primero.name || `${clave}.${listo.extension}`;
    const r = await registrar({
      tipo, etiqueta, numero: numero?.trim() || null, ruta, nombre,
      asignacionId: opciones.asignacionId ?? null, tipoMime: listo.tipo, tamano: listo.blob.size,
      reemplaza: opciones.reemplaza ?? null,
    });
    alCambiar(r.ok ? { fase: 'listo', mensaje: r.mensaje } : { fase: 'error', mensaje: r.mensaje });
    return r.ok;
  } catch (err) {
    alCambiar({ fase: 'error', mensaje: err instanceof Error ? err.message : 'No se pudo subir el documento.' });
    return false;
  }
}
