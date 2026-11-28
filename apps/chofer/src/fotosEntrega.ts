import * as SQLite from 'expo-sqlite';
import { Directory, File, Paths } from 'expo-file-system';
import { supabase } from './supabase';

/**
 * Fotos de la entrega (guía firmada y novedades). Se guardan primero en el teléfono
 * y se suben cuando hay señal: la prueba de entrega no espera a las fotos. Cada foto
 * se borra del teléfono solo cuando el servidor confirma que la recibió.
 */
let db: SQLite.SQLiteDatabase | null = null;

async function abrir() {
  if (!db) {
    db = await SQLite.openDatabaseAsync('entregas.db');
    await db.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS fotos_pendientes (
        ruta TEXT PRIMARY KEY,        -- <misión>/entrega-<id>.jpg en el almacenamiento
        asignacion TEXT NOT NULL,
        archivo TEXT NOT NULL,        -- copia local (carpeta de documentos de la app)
        intentos INTEGER NOT NULL DEFAULT 0,
        creado INTEGER NOT NULL
      );
    `);
  }
  return db;
}

function carpeta() {
  const d = new Directory(Paths.document, 'entregas');
  if (!d.exists) d.create({ intermediates: true, idempotent: true });
  return d;
}

function idAleatorio() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** Copia la foto de la cámara a la carpeta de la app (la caché se puede borrar sola). */
export function guardarFotoLocal(uriTemporal: string): string {
  const origen = new File(uriTemporal);
  const destino = new File(carpeta(), `${idAleatorio()}.jpg`);
  origen.copy(destino);
  try { origen.delete(); } catch { /* la caché la limpia el sistema */ }
  return destino.uri;
}

/** Borra una foto local que el chofer descartó antes de enviar. */
export function borrarFotoLocal(uri: string) {
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch { /* nada que borrar */ }
}

/** Ruta en el almacenamiento para una foto de la entrega de esta misión. */
export function rutaFoto(misionId: string) {
  return `${misionId}/entrega-${idAleatorio()}.jpg`;
}

export async function encolarFotos(asignacion: string, fotos: { ruta: string; archivo: string }[]) {
  if (fotos.length === 0) return;
  const base = await abrir();
  await base.withTransactionAsync(async () => {
    for (const f of fotos) {
      await base.runAsync(
        'INSERT OR IGNORE INTO fotos_pendientes (ruta, asignacion, archivo, creado) VALUES (?, ?, ?, ?)',
        f.ruta, asignacion, f.archivo, Date.now(),
      );
    }
  });
}

export async function contarFotosPendientes(): Promise<number> {
  const base = await abrir();
  const fila = await base.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM fotos_pendientes');
  return fila?.n ?? 0;
}

async function quitar(ruta: string, archivo: string) {
  const base = await abrir();
  await base.runAsync('DELETE FROM fotos_pendientes WHERE ruta = ?', ruta);
  borrarFotoLocal(archivo);
}

/** Errores que no se arreglan reintentando (la foto ya no corresponde a ninguna entrega). */
function esDefinitivo(mensaje: string) {
  return /no es de esta entrega|no tiene prueba de entrega|Sin acceso/i.test(mensaje);
}

let subiendo: Promise<number> | null = null;

/**
 * Sube las fotos pendientes, una por una. Se detiene al primer problema de señal.
 * Devuelve cuántas quedan.
 */
export function subirFotosPendientes(): Promise<number> {
  if (!subiendo) {
    subiendo = subir().finally(() => { subiendo = null; });
  }
  return subiendo;
}

async function subir(): Promise<number> {
  const base = await abrir();
  const filas = await base.getAllAsync<{ ruta: string; asignacion: string; archivo: string; intentos: number }>(
    'SELECT ruta, asignacion, archivo, intentos FROM fotos_pendientes ORDER BY creado',
  );
  for (const f of filas) {
    const local = new File(f.archivo);
    if (!local.exists) {
      // La foto ya no está en el teléfono: no hay nada que subir.
      await quitar(f.ruta, f.archivo);
      continue;
    }
    await base.runAsync('UPDATE fotos_pendientes SET intentos = intentos + 1 WHERE ruta = ?', f.ruta);
    try {
      const datos = await local.arrayBuffer();
      const { error: errorSubida } = await supabase.storage
        .from('documentos')
        .upload(f.ruta, datos, { contentType: 'image/jpeg', upsert: false });
      // Si ya estaba subida (un intento anterior se cortó después de subir), se sigue.
      if (errorSubida && !/exists|duplicate/i.test(errorSubida.message)) throw errorSubida;
      const { error } = await supabase.rpc('foto_entrega_subida', { p_asignacion: f.asignacion, p_ruta: f.ruta });
      if (error) {
        if (esDefinitivo(error.message)) {
          await quitar(f.ruta, f.archivo);
          continue;
        }
        throw error;
      }
      await quitar(f.ruta, f.archivo);
    } catch {
      break; // sin señal (u otro problema pasajero): se reintenta la próxima vez
    }
  }
  return contarFotosPendientes();
}
