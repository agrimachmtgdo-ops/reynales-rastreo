import * as Location from 'expo-location';
import { INTERVALOS, MARCA } from '@reynales/shared';
import { TAREA_UBICACION } from './tareaUbicacion';

export type ResultadoPermisos = 'ok' | 'sin_permiso' | 'sin_segundo_plano' | 'gps_apagado';

/** Pide permisos: primero "mientras se usa", luego "todo el tiempo" (Android lo exige en dos pasos). */
export async function pedirPermisos(): Promise<ResultadoPermisos> {
  if (!(await Location.hasServicesEnabledAsync())) return 'gps_apagado';
  const primerPlano = await Location.requestForegroundPermissionsAsync();
  if (primerPlano.status !== 'granted') return 'sin_permiso';
  const segundoPlano = await Location.requestBackgroundPermissionsAsync();
  if (segundoPlano.status !== 'granted') return 'sin_segundo_plano';
  return 'ok';
}

export async function iniciarRastreo(): Promise<ResultadoPermisos> {
  const permisos = await pedirPermisos();
  if (permisos !== 'ok') return permisos;
  if (await Location.hasStartedLocationUpdatesAsync(TAREA_UBICACION)) return 'ok';

  await Location.startLocationUpdatesAsync(TAREA_UBICACION, {
    accuracy: Location.Accuracy.High,
    timeInterval: INTERVALOS.capturaEnMovimientoS * 1000,
    distanceInterval: 0, // también se reciben puntos detenido; la tarea los raléa
    deferredUpdatesInterval: 60_000, // Android entrega los puntos agrupados: ahorra batería
    pausesUpdatesAutomatically: false,
    activityType: Location.ActivityType.AutomotiveNavigation,
    foregroundService: {
      notificationTitle: 'Viaje en curso · Industrias Reynales',
      notificationBody: 'Se registra la ubicación del camión hasta que marque "Entregado".',
      notificationColor: MARCA.verde,
      killServiceOnDestroy: false,
    },
  });
  return 'ok';
}

export async function detenerRastreo() {
  if (await Location.hasStartedLocationUpdatesAsync(TAREA_UBICACION)) {
    await Location.stopLocationUpdatesAsync(TAREA_UBICACION);
  }
}

export async function rastreoActivo() {
  return Location.hasStartedLocationUpdatesAsync(TAREA_UBICACION);
}
