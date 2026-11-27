import { Linking, ScrollView, Text, View } from 'react-native';
import * as Device from 'expo-device';
import * as IntentLauncher from 'expo-intent-launcher';
import { Boton } from '../componentes';
import { e } from '../estilos';

// Consejos según la marca: muchas marcas cierran apps en segundo plano para ahorrar batería.
const CONSEJOS: Record<string, string> = {
  xiaomi: 'Ajustes → Apps → Reynales Chofer → Ahorro de batería → "Sin restricciones". Active también "Inicio automático".',
  redmi: 'Ajustes → Apps → Reynales Chofer → Ahorro de batería → "Sin restricciones". Active también "Inicio automático".',
  samsung: 'Ajustes → Batería → Límites de uso en segundo plano → quite Reynales Chofer de "Apps en suspensión".',
  huawei: 'Ajustes → Batería → Inicio de aplicaciones → Reynales Chofer → "Gestionar manualmente" y active las 3 opciones.',
  honor: 'Ajustes → Batería → Inicio de aplicaciones → Reynales Chofer → "Gestionar manualmente" y active las 3 opciones.',
  oppo: 'Ajustes → Batería → Reynales Chofer → permita "Actividad en segundo plano".',
  realme: 'Ajustes → Batería → Reynales Chofer → permita "Actividad en segundo plano".',
  vivo: 'Ajustes → Batería → Consumo en segundo plano alto → active Reynales Chofer.',
  motorola: 'Ajustes → Batería → Uso de la batería de apps → Reynales Chofer → "Sin restricciones".',
};

export default function AjustesTelefono({ alVolver }: { alVolver: () => void }) {
  const marca = (Device.manufacturer ?? '').toLowerCase();
  const consejo = Object.entries(CONSEJOS).find(([clave]) => marca.includes(clave))?.[1];

  return (
    <ScrollView contentContainerStyle={e.contenido}>
      <Text style={e.titulo}>Ajustes del teléfono</Text>
      <Text style={e.texto}>Para que el rastreo no se corte durante el viaje, haga estos dos pasos una sola vez:</Text>
      <View style={e.tarjeta}>
        <Text style={e.etiqueta}>1. Ubicación “Permitir todo el tiempo”</Text>
        <Text style={e.texto}>En Permisos → Ubicación elija “Permitir todo el tiempo”.</Text>
        <Boton texto="Abrir permisos de la app" variante="dorado" onPress={() => Linking.openSettings()} />
      </View>
      <View style={e.tarjeta}>
        <Text style={e.etiqueta}>2. Batería sin restricciones</Text>
        <Text style={e.texto}>{consejo ?? 'En Ajustes → Batería, quite las restricciones para Reynales Chofer.'}</Text>
        <Text style={e.textoChico}>Teléfono detectado: {Device.manufacturer} {Device.modelName}</Text>
        <Boton
          texto="Abrir ajustes de batería"
          variante="dorado"
          onPress={() => IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.IGNORE_BATTERY_OPTIMIZATION_SETTINGS)}
        />
      </View>
      <Boton texto="Volver" variante="cafe" onPress={alVolver} />
    </ScrollView>
  );
}
