import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Linking from 'expo-linking';
import { useFonts } from 'expo-font';
// Solo los tres pesos que se usan (importar el paquete completo agrega ~6 MB a la app).
import { Montserrat_400Regular } from '@expo-google-fonts/montserrat/400Regular';
import { Montserrat_600SemiBold } from '@expo-google-fonts/montserrat/600SemiBold';
import { Montserrat_700Bold } from '@expo-google-fonts/montserrat/700Bold';
import { MARCA, type Etapa } from '@reynales/shared';
import { asegurarSesion, supabase } from './src/supabase';
import { guardarEstado, leerEstado, reiniciarEstado } from './src/estado';
import { enviarPendientes } from './src/envio';
import { e } from './src/estilos';
import Activar, { extraerCodigo } from './src/pantallas/Activar';
import Consentimiento from './src/pantallas/Consentimiento';
import Viaje from './src/pantallas/Viaje';
import AjustesTelefono from './src/pantallas/AjustesTelefono';
import type { Viaje as TViaje } from './src/tipos';

type Pantalla = 'cargando' | 'activar' | 'consentimiento' | 'viaje' | 'ajustes';

const ETAPAS_ACTIVAS: Etapa[] = ['cargado', 'en_ruta', 'en_frontera', 'cruzo_frontera'];

/** Guarda el viaje en el teléfono; si es otro viaje, empieza de cero (sin puntos del anterior). */
async function recordarViaje(v: TViaje) {
  const s = await leerEstado();
  if (s.asignacionId === v.asignacion_id) await guardarEstado({ viaje: v });
  else await reiniciarEstado(v.asignacion_id, v.etapa, v);
}

export default function App() {
  const [fuentes] = useFonts({ Montserrat_400Regular, Montserrat_600SemiBold, Montserrat_700Bold });
  const [pantalla, setPantalla] = useState<Pantalla>('cargando');
  const [viaje, setViaje] = useState<TViaje | null>(null);
  const [codigoEnlace, setCodigoEnlace] = useState<string | undefined>();
  const [aviso, setAviso] = useState<string | null>(null);

  const mostrarViaje = useCallback((v: TViaje | null) => {
    if (v) void recordarViaje(v);
    setViaje(v);
    if (!v) setPantalla('activar');
    else if (v.requiere_consentimiento) setPantalla('consentimiento');
    else setPantalla('viaje');
  }, []);

  // Al abrir: sesión anónima y viaje vigente (si lo hay).
  const cargar = useCallback(async () => {
    setPantalla('cargando');
    setAviso(null);
    try {
      await asegurarSesion();
      const { data, error } = await supabase.rpc('mi_viaje');
      if (error) throw error;
      const v = (data as TViaje | null) ?? null;
      if (!v) await guardarEstado({ viaje: null });
      mostrarViaje(v);
      // Envía lo que haya quedado pendiente (por ejemplo, el último tramo de un viaje ya entregado).
      void enviarPendientes(true);
    } catch {
      // Sin señal: si había un viaje en curso, se muestra desde el teléfono y el rastreo sigue.
      const s = await leerEstado();
      if (s.viaje && !s.sinAcceso && s.etapa && ETAPAS_ACTIVAS.includes(s.etapa)) {
        setAviso('Sin conexión. Su viaje sigue activo y la ubicación se guarda en el teléfono hasta recuperar señal.');
        setViaje({ ...s.viaje, etapa: s.etapa, requiere_consentimiento: false });
        setPantalla('viaje');
      } else {
        setAviso('Sin conexión. Revise su señal y toque aquí para reintentar.');
        setPantalla('activar');
      }
    }
  }, [mostrarViaje]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // Enlace "reynaleschofer://activar?codigo=XXXX" (desde el QR o un enlace).
  const url = Linking.useURL();
  useEffect(() => {
    if (url && url.includes('codigo=')) setCodigoEnlace(extraerCodigo(url));
  }, [url]);

  if (!fuentes) {
    return <View style={[e.pantalla, { justifyContent: 'center' }]}><ActivityIndicator color={MARCA.verde} /></View>;
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={e.pantalla}>
        <StatusBar style="dark" />
        {aviso && (
          <Pressable onPress={() => void cargar()} accessibilityRole="button" accessibilityHint="Vuelve a intentar la conexión">
            <Text style={[e.texto, { padding: 12, backgroundColor: '#FBECC0' }]}>{aviso}</Text>
          </Pressable>
        )}
        {pantalla === 'cargando' && (
          <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator size="large" color={MARCA.verde} /></View>
        )}
        {pantalla === 'activar' && (
          <Activar key={codigoEnlace} codigoInicial={codigoEnlace} alActivar={async (v) => {
            await enviarPendientes(true); // si quedó algo del viaje anterior, se intenta enviar antes
            await reiniciarEstado(v.asignacion_id, v.etapa, v);
            mostrarViaje(v);
          }} />
        )}
        {pantalla === 'consentimiento' && viaje && <Consentimiento viaje={viaje} alAceptar={mostrarViaje} />}
        {pantalla === 'viaje' && viaje && (
          <Viaje viaje={viaje} alTerminar={() => mostrarViaje(null)} alAbrirAjustes={() => setPantalla('ajustes')} />
        )}
        {pantalla === 'ajustes' && <AjustesTelefono alVolver={() => setPantalla('viaje')} />}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
