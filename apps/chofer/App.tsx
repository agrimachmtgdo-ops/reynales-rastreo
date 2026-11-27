import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Linking from 'expo-linking';
import { useFonts } from 'expo-font';
// Solo los tres pesos que se usan (importar el paquete completo agrega ~6 MB a la app).
import { Montserrat_400Regular } from '@expo-google-fonts/montserrat/400Regular';
import { Montserrat_600SemiBold } from '@expo-google-fonts/montserrat/600SemiBold';
import { Montserrat_700Bold } from '@expo-google-fonts/montserrat/700Bold';
import { MARCA } from '@reynales/shared';
import { asegurarSesion, supabase } from './src/supabase';
import { reiniciarEstado } from './src/estado';
import { e } from './src/estilos';
import Activar, { extraerCodigo } from './src/pantallas/Activar';
import Consentimiento from './src/pantallas/Consentimiento';
import Viaje from './src/pantallas/Viaje';
import AjustesTelefono from './src/pantallas/AjustesTelefono';
import type { Viaje as TViaje } from './src/tipos';

type Pantalla = 'cargando' | 'activar' | 'consentimiento' | 'viaje' | 'ajustes';

export default function App() {
  const [fuentes] = useFonts({ Montserrat_400Regular, Montserrat_600SemiBold, Montserrat_700Bold });
  const [pantalla, setPantalla] = useState<Pantalla>('cargando');
  const [viaje, setViaje] = useState<TViaje | null>(null);
  const [codigoEnlace, setCodigoEnlace] = useState<string | undefined>();
  const [aviso, setAviso] = useState<string | null>(null);

  const mostrarViaje = useCallback((v: TViaje | null) => {
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
      mostrarViaje((data as TViaje | null) ?? null);
    } catch {
      setAviso('Sin conexión. Si ya inició el viaje, el rastreo sigue guardando su ubicación.');
      setPantalla('activar');
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
        {aviso && <Text style={[e.textoChico, { padding: 12, backgroundColor: '#FBECC0' }]}>{aviso}</Text>}
        {pantalla === 'cargando' && (
          <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator size="large" color={MARCA.verde} /></View>
        )}
        {pantalla === 'activar' && (
          <Activar key={codigoEnlace} codigoInicial={codigoEnlace} alActivar={(v) => { void reiniciarEstado(v.asignacion_id, v.etapa); mostrarViaje(v); }} />
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
