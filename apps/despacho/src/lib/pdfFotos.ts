/**
 * Une varias fotos JPEG en un solo PDF, una hoja por foto, en el propio navegador
 * (sin librerías ni servidores). Cada hoja es A4, vertical u horizontal según la foto,
 * con 18 pt de margen.
 */
export interface HojaJpeg {
  blob: Blob;
  ancho: number;
  alto: number;
}

const A4: [number, number] = [595.28, 841.89];
const MARGEN = 18;

export async function unirFotosEnPdf(hojas: HojaJpeg[]): Promise<Blob> {
  const codificador = new TextEncoder();
  const partes: Uint8Array[] = [];
  const posiciones: number[] = [];
  let largo = 0;
  const agregar = (p: Uint8Array | string) => {
    const bytes = typeof p === 'string' ? codificador.encode(p) : p;
    partes.push(bytes);
    largo += bytes.length;
  };
  const objeto = (numero: number, cuerpo: string) => {
    posiciones[numero] = largo;
    agregar(`${numero} 0 obj\n${cuerpo}\nendobj\n`);
  };

  // 1 = catálogo, 2 = páginas; cada hoja usa 3 objetos (página, imagen, contenido).
  const paginas = hojas.map((_, i) => 3 + i * 3);
  agregar('%PDF-1.4\n%âãÏÓ\n');
  objeto(1, '<< /Type /Catalog /Pages 2 0 R >>');
  objeto(2, `<< /Type /Pages /Kids [${paginas.map((n) => `${n} 0 R`).join(' ')}] /Count ${hojas.length} >>`);

  for (let i = 0; i < hojas.length; i++) {
    const h = hojas[i]!;
    const [pAncho, pAlto] = h.ancho > h.alto ? [A4[1], A4[0]] : A4;
    const escala = Math.min((pAncho - 2 * MARGEN) / h.ancho, (pAlto - 2 * MARGEN) / h.alto);
    const w = h.ancho * escala;
    const hh = h.alto * escala;
    const x = (pAncho - w) / 2;
    const y = (pAlto - hh) / 2;
    const nPagina = paginas[i]!;
    const nImagen = nPagina + 1;
    const nContenido = nPagina + 2;
    objeto(nPagina, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pAncho.toFixed(2)} ${pAlto.toFixed(2)}] `
      + `/Resources << /XObject << /Im${i} ${nImagen} 0 R >> >> /Contents ${nContenido} 0 R >>`);
    const jpeg = new Uint8Array(await h.blob.arrayBuffer());
    posiciones[nImagen] = largo;
    agregar(`${nImagen} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${h.ancho} /Height ${h.alto} `
      + `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
    agregar(jpeg);
    agregar('\nendstream\nendobj\n');
    const dibujo = `q ${w.toFixed(2)} 0 0 ${hh.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im${i} Do Q`;
    objeto(nContenido, `<< /Length ${dibujo.length} >>\nstream\n${dibujo}\nendstream`);
  }

  const total = 3 + hojas.length * 3;
  const inicioXref = largo;
  let xref = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let n = 1; n < total; n++) xref += `${String(posiciones[n] ?? 0).padStart(10, '0')} 00000 n \n`;
  agregar(xref);
  agregar(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${inicioXref}\n%%EOF\n`);
  return new Blob(partes as BlobPart[], { type: 'application/pdf' });
}
