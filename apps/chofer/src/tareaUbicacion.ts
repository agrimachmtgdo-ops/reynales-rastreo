import * as TaskManager from 'expo-task-manager';
import type { LocationObject } from 'expo-location';
import { compactar, type PosicionCompacta } from '@reynales/shared';
import { encolar } from './cola';
import { guardarEstado, leerEstado } from './estado';
import { enviarPendientes } from './envio';

export const TAREA_UBICACION = 'reynales-rastreo-ubicacion';

// Detenido: guardar como máximo una posición cada 5 minutos.
const INTERVALO_DETENIDO_MS = 5 * 60 * 1000;
const VELOCIDAD_DETENIDO_KMH = 3;
const DISTANCIA_MINIMA_M = 50;

function distanciaM(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const r = 6371000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

TaskManager.defineTask<{ locations: LocationObject[] }>(TAREA_UBICACION, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;

  const estado = await leerEstado();
  if (!estado.asignacionId) return;

  let ultimo = estado.ultimoGuardado;
  let velocidad = estado.ultimaVelocidadKmh;
  const aGuardar: PosicionCompacta[] = [];

  for (const l of data.locations) {
    const punto = { t: l.timestamp, lat: l.coords.latitude, lon: l.coords.longitude };
    const kmh = l.coords.speed != null && l.coords.speed >= 0 ? l.coords.speed * 3.6 : 0;
    velocidad = kmh;

    // Frecuencia adaptativa: si está detenido y casi no se movió, se omite el punto.
    const detenido = kmh < VELOCIDAD_DETENIDO_KMH;
    if (ultimo && detenido && punto.t - ultimo.t < INTERVALO_DETENIDO_MS && distanciaM(ultimo, punto) < DISTANCIA_MINIMA_M) {
      continue;
    }
    aGuardar.push(
      compactar({
        capturadoEn: l.timestamp,
        lat: punto.lat,
        lon: punto.lon,
        velocidadKmh: kmh,
        precisionM: l.coords.accuracy,
        simulada: l.mocked === true,
      }),
    );
    ultimo = punto;
  }

  await encolar(aGuardar);
  await guardarEstado({ ultimoGuardado: ultimo, ultimaVelocidadKmh: velocidad });

  const respuesta = await enviarPendientes();
  if (respuesta && !respuesta.rastrear) {
    // El viaje se cerró desde despacho: se apaga el GPS.
    const { detenerRastreo } = await import('./rastreo');
    await detenerRastreo();
  }
});
