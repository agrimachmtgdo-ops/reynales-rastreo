import * as SQLite from 'expo-sqlite';
import type { PosicionCompacta } from '@reynales/shared';

/**
 * Cola local de posiciones: se guardan siempre aquí primero y se borran
 * solo cuando el servidor confirma. Así no se pierde nada sin señal.
 */
let db: SQLite.SQLiteDatabase | null = null;

async function abrir() {
  if (!db) {
    db = await SQLite.openDatabaseAsync('rastreo.db');
    await db.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS pendientes (
        t INTEGER PRIMARY KEY,   -- segundos unix (evita duplicados del mismo segundo)
        lat INTEGER NOT NULL, lon INTEGER NOT NULL,
        vel INTEGER NOT NULL, prec INTEGER NOT NULL, sim INTEGER NOT NULL
      );
    `);
  }
  return db;
}

export async function encolar(posiciones: PosicionCompacta[]) {
  if (posiciones.length === 0) return;
  const base = await abrir();
  await base.withTransactionAsync(async () => {
    for (const p of posiciones) {
      await base.runAsync(
        'INSERT OR IGNORE INTO pendientes (t, lat, lon, vel, prec, sim) VALUES (?, ?, ?, ?, ?, ?)',
        p[0], p[1], p[2], p[3], p[4], p[5],
      );
    }
  });
}

export async function tomarLote(maximo: number): Promise<PosicionCompacta[]> {
  const base = await abrir();
  const filas = await base.getAllAsync<{ t: number; lat: number; lon: number; vel: number; prec: number; sim: number }>(
    'SELECT t, lat, lon, vel, prec, sim FROM pendientes ORDER BY t LIMIT ?',
    maximo,
  );
  return filas.map((f) => [f.t, f.lat, f.lon, f.vel, f.prec, f.sim === 1 ? 1 : 0]);
}

export async function confirmarHasta(tMaximo: number) {
  const base = await abrir();
  await base.runAsync('DELETE FROM pendientes WHERE t <= ?', tMaximo);
}

export async function contarPendientes(): Promise<number> {
  const base = await abrir();
  const fila = await base.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM pendientes');
  return fila?.n ?? 0;
}

export async function vaciarCola() {
  const base = await abrir();
  await base.runAsync('DELETE FROM pendientes');
}
