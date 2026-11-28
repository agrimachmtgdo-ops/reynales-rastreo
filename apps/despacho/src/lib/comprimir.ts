'use client';

/** Máximo por archivo (lo mismo que admite el almacenamiento). */
export const MAXIMO_BYTES = 10 * 1024 * 1024;
/** Las fotos se achican hasta quedar por debajo de 1 MB (datos móviles del celular). */
const OBJETIVO_FOTO = 1024 * 1024;

function aBlob(lienzo: HTMLCanvasElement, calidad: number): Promise<Blob | null> {
  return new Promise((resolver) => lienzo.toBlob(resolver, 'image/jpeg', calidad));
}

/**
 * Prepara el archivo para subir: los PDF van tal cual (máx. 10 MB); las fotos se convierten
 * a JPEG de hasta 1.600 px y se comprimen hasta pesar menos de 1 MB.
 */
export async function prepararArchivo(archivo: File): Promise<{ blob: Blob; tipo: string; extension: string }> {
  if (archivo.type === 'application/pdf') {
    if (archivo.size > MAXIMO_BYTES) throw new Error('El PDF pesa más de 10 MB. Escanéelo con menos resolución.');
    return { blob: archivo, tipo: 'application/pdf', extension: 'pdf' };
  }
  if (!archivo.type.startsWith('image/')) throw new Error('Suba una foto o un PDF.');
  let imagen: ImageBitmap;
  try {
    imagen = await createImageBitmap(archivo);
  } catch {
    throw new Error('No se pudo leer la foto. Tómela de nuevo o envíela como PDF.');
  }
  let lado = 1600;
  for (let intento = 0; intento < 6; intento++) {
    const escala = Math.min(1, lado / Math.max(imagen.width, imagen.height));
    const lienzo = document.createElement('canvas');
    lienzo.width = Math.round(imagen.width * escala);
    lienzo.height = Math.round(imagen.height * escala);
    lienzo.getContext('2d')!.drawImage(imagen, 0, 0, lienzo.width, lienzo.height);
    for (const calidad of [0.8, 0.65, 0.5]) {
      const blob = await aBlob(lienzo, calidad);
      if (blob && blob.size <= OBJETIVO_FOTO) return { blob, tipo: 'image/jpeg', extension: 'jpg' };
    }
    lado = Math.round(lado * 0.75);
  }
  throw new Error('La foto es demasiado pesada. Tómela de nuevo con menos zoom.');
}
