import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, PermissionsAndroid, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import * as Application from 'expo-application';
import * as Battery from 'expo-battery';
import * as Device from 'expo-device';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Location from 'expo-location';
import { MARCA } from '@reynales/shared';
import { Boton } from '../componentes';
import { e, F } from '../estilos';
import { pedirPermisos } from '../rastreo';

// Consejos según la marca: muchas marcas cierran apps en segundo plano para ahorrar batería.
const CONSEJOS: Record<string, string> = {
  xiaomi: 'Ajustes → Apps → Reynales Chofer → Ahorro de batería → "Sin restricciones". Active también "Inicio automático".',
  redmi: 'Ajustes → Apps → Reynales Chofer → Ahorro de batería → "Sin restricciones". Active también "Inicio automático".',
  poco: 'Ajustes → Apps → Reynales Chofer → Ahorro de batería → "Sin restricciones". Active también "Inicio automático".',
  samsung: 'Ajustes → Batería → Límites de uso en segundo plano → quite Reynales Chofer de "Apps en suspensión".',
  huawei: 'Ajustes → Batería → Inicio de aplicaciones → Reynales Chofer → "Gestionar manualmente" y active las 3 opciones.',
  honor: 'Ajustes → Batería → Inicio de aplicaciones → Reynales Chofer → "Gestionar manualmente" y active las 3 opciones.',
  oppo: 'Ajustes → Batería → Reynales Chofer → permita "Actividad en segundo plano".',
  realme: 'Ajustes → Batería → Reynales Chofer → permita "Actividad en segundo plano".',
  vivo: 'Ajustes → Batería → Consumo en segundo plano alto → active Reynales Chofer.',
  motorola: 'Ajustes → Batería → Uso de la batería de apps → Reynales Chofer → "Sin restricciones".',
};

interface Revision {
  gps: boolean;
  ubicacion: boolean;
  /** null = este teléfono no permite comprobarlo. */
  bateria: boolean | null;
  notificaciones: boolean | null;
}

const pideNotificaciones = Platform.OS === 'android' && Number(Platform.Version) >= 33;

async function revisar(): Promise<Revision> {
  const gps = await Location.hasServicesEnabledAsync().catch(() => false);
  const fondo = await Location.getBackgroundPermissionsAsync().catch(() => null);
  let bateria: boolean | null = null;
  try {
    bateria = !(await Battery.isBatteryOptimizationEnabledAsync());
  } catch {
    bateria = null;
  }
  let notificaciones: boolean | null = null;
  if (pideNotificaciones) {
    notificaciones = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS).catch(() => null);
  }
  return { gps, ubicacion: fondo?.status === 'granted', bateria, notificaciones };
}

function Paso({
  ok,
  titulo,
  detalle,
  boton,
  alTocar,
}: {
  ok: boolean | null;
  titulo: string;
  detalle: string;
  boton: string;
  alTocar: () => void;
}) {
  const color = ok === true ? MARCA.verdeOscuro : ok === false ? MARCA.rojo : MARCA.dorado;
  const simbolo = ok === true ? '✓' : ok === false ? '✗' : '?';
  return (
    <View style={[e.tarjeta, { flexDirection: 'row', gap: 12, alignItems: 'flex-start' }]}>
      <View
        style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}
        accessibilityLabel={ok === true ? 'Listo' : ok === false ? 'Falta' : 'No se pudo comprobar'}
      >
        <Text style={{ color: MARCA.blanco, fontFamily: F.negrita, fontSize: 18 }}>{simbolo}</Text>
      </View>
      <View style={{ flex: 1, gap: 6 }}>
        <Text style={[e.etiqueta, { fontSize: 16 }]}>{titulo}</Text>
        {ok !== true && <Text style={e.texto}>{detalle}</Text>}
        {ok !== true && <Boton texto={boton} variante="dorado" onPress={alTocar} />}
      </View>
    </View>
  );
}

/**
 * Revisión de los ajustes que hacen que el rastreo no se corte.
 * Con `alContinuar` es el paso obligatorio antes de "Iniciar viaje".
 */
export default function AjustesTelefono({ alVolver, alContinuar }: { alVolver: () => void; alContinuar?: () => void }) {
  const [r, setR] = useState<Revision | null>(null);
  const marca = (Device.manufacturer ?? '').toLowerCase();
  const consejo = Object.entries(CONSEJOS).find(([clave]) => marca.includes(clave))?.[1];

  const actualizar = useCallback(async () => setR(await revisar()), []);

  // Se vuelve a revisar al regresar de los ajustes de Android.
  useEffect(() => {
    void actualizar();
    const sub = AppState.addEventListener('change', (estado) => {
      if (estado === 'active') void actualizar();
    });
    return () => sub.remove();
  }, [actualizar]);

  async function encenderGps() {
    try {
      await Location.enableNetworkProviderAsync();
    } catch {
      await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.LOCATION_SOURCE_SETTINGS).catch(() => undefined);
    }
    await actualizar();
  }

  async function permitirUbicacion() {
    const resultado = await pedirPermisos();
    if (resultado === 'sin_permiso' || resultado === 'sin_segundo_plano') await Linking.openSettings();
    await actualizar();
  }

  async function quitarAhorro() {
    try {
      // Ventana directa de Android: "¿Permitir que la app se ejecute en segundo plano?"
      await IntentLauncher.startActivityAsync('android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS', {
        data: `package:${Application.applicationId ?? 'bo.reynales.chofer'}`,
      });
    } catch {
      await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.IGNORE_BATTERY_OPTIMIZATION_SETTINGS).catch(() => undefined);
    }
    await actualizar();
  }

  async function permitirNotificaciones() {
    const res = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS).catch(() => null);
    if (res === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN || res === PermissionsAndroid.RESULTS.DENIED) await Linking.openSettings();
    await actualizar();
  }

  const obligatoriosListos = !!r && r.gps && r.ubicacion;
  const bateriaFalta = r?.bateria === false;

  return (
    <ScrollView contentContainerStyle={e.contenido}>
      <Text style={e.titulo}>{alContinuar ? 'Antes de iniciar el viaje' : 'Ajustes del teléfono'}</Text>
      <Text style={e.texto}>
        {alContinuar
          ? 'Revise estos ajustes para que el rastreo no se corte en el camino. Toma un minuto.'
          : 'Estos ajustes hacen que el rastreo no se corte durante el viaje.'}
      </Text>
      {!r ? (
        <Text style={e.textoChico}>Revisando…</Text>
      ) : (
        <>
          <Paso ok={r.gps} titulo="GPS encendido" detalle="La ubicación del teléfono está apagada." boton="Encender GPS" alTocar={() => void encenderGps()} />
          <Paso
            ok={r.ubicacion}
            titulo='Ubicación "Permitir todo el tiempo"'
            detalle='En Permisos → Ubicación elija "Permitir todo el tiempo". Sin esto el rastreo se detiene con la pantalla apagada.'
            boton="Dar permiso de ubicación"
            alTocar={() => void permitirUbicacion()}
          />
          <Paso
            ok={r.bateria}
            titulo="Batería sin restricciones"
            detalle={
              r.bateria === null
                ? `Este teléfono no permite comprobarlo. ${consejo ?? 'En Ajustes → Batería, quite las restricciones para Reynales Chofer.'}`
                : 'Toque el botón y elija "Permitir". Si no aparece la ventana, quite las restricciones de batería para Reynales Chofer.'
            }
            boton="Quitar ahorro de batería"
            alTocar={() => void quitarAhorro()}
          />
          {consejo && r.bateria === true && (
            <Text style={e.textoChico}>En {Device.manufacturer}, revise también: {consejo}</Text>
          )}
          {r.notificaciones !== null && (
            <Paso
              ok={r.notificaciones}
              titulo="Notificaciones permitidas"
              detalle="Permite ver el aviso «Viaje en curso» mientras se registra la ubicación."
              boton="Permitir notificaciones"
              alTocar={() => void permitirNotificaciones()}
            />
          )}
          <Text style={e.textoChico}>Teléfono: {Device.manufacturer} {Device.modelName}</Text>
        </>
      )}

      {alContinuar ? (
        <>
          {!obligatoriosListos && r && <Text style={e.error}>Falta encender el GPS y dar el permiso de ubicación para iniciar.</Text>}
          <Boton texto="Continuar" onPress={alContinuar} deshabilitado={!obligatoriosListos || bateriaFalta} />
          {obligatoriosListos && bateriaFalta && (
            <Pressable onPress={alContinuar} accessibilityRole="button" style={{ paddingVertical: 12, alignItems: 'center' }}>
              <Text style={[e.etiqueta, { textDecorationLine: 'underline' }]}>Continuar sin quitar el ahorro (el rastreo puede cortarse)</Text>
            </Pressable>
          )}
          <Boton texto="Volver" variante="cafe" onPress={alVolver} />
        </>
      ) : (
        <Boton texto="Volver" variante="cafe" onPress={alVolver} />
      )}
    </ScrollView>
  );
}
