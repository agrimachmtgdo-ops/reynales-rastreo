import { NextResponse, type NextRequest } from 'next/server';
import { crearClienteServidor } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const respuesta = (texto: string, estado: number) =>
  new NextResponse(texto, { status: estado, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

/**
 * Abre un documento: valida el permiso en la base de datos (el operador de transbordo no
 * abre facturas), deja constancia de quién lo abrió y redirige a un enlace firmado de 60 s.
 * Con ?descargar=1 el navegador lo descarga con su nombre original.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return respuesta('Documento no válido.', 400);
  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.rpc('abrir_documento', { p_documento: id });
  if (error || !data) {
    const sinPermiso = error?.code === '42501';
    return respuesta(sinPermiso ? 'No tiene permiso para ver este documento.' : 'No se encontró el documento.', sinPermiso ? 403 : 404);
  }
  const doc = data as { ruta: string; nombre: string | null };
  const descargar = request.nextUrl.searchParams.get('descargar') === '1';
  const { data: firmado, error: errorFirma } = await supabase.storage.from('documentos')
    .createSignedUrl(doc.ruta, 60, descargar ? { download: doc.nombre || true } : undefined);
  if (errorFirma || !firmado?.signedUrl) return respuesta('El archivo no está disponible. Avise a despacho.', 404);
  const r = NextResponse.redirect(firmado.signedUrl, 302);
  r.headers.set('Cache-Control', 'no-store');
  r.headers.set('Referrer-Policy', 'no-referrer');
  return r;
}
