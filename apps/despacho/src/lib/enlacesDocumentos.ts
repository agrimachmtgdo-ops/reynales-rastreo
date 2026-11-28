import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { DocumentoVigente } from './documentos';

/** Enlaces firmados de 10 minutos para ver cada documento (el bucket es privado). */
export async function enlacesDocumentos(supabase: SupabaseClient, documentos: DocumentoVigente[]): Promise<Record<string, string>> {
  if (documentos.length === 0) return {};
  const { data } = await supabase.storage.from('documentos').createSignedUrls(documentos.map((d) => d.ruta), 600);
  const enlaces: Record<string, string> = {};
  for (const f of data ?? []) if (f.path && f.signedUrl) enlaces[f.path] = f.signedUrl;
  return enlaces;
}
