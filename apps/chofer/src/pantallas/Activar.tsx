import { useState } from 'react';
import { Image, ScrollView, Text, TextInput, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Application from 'expo-application';
import { supabase, asegurarSesion } from '../supabase';
import { Boton } from '../componentes';
import { e } from '../estilos';
import { mensajeSimple } from '../mensajes';
import type { Viaje } from '../tipos';

/** Extrae el código de "reynaleschofer://activar?codigo=XXXX" o del texto escrito. */
export function extraerCodigo(texto: string): string {
  const coincide = texto.match(/codigo=([A-Za-z0-9]+)/);
  return (coincide?.[1] ?? texto).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

export default function Activar({ codigoInicial, alActivar }: { codigoInicial?: string; alActivar: (v: Viaje) => void | Promise<void> }) {
  const [codigo, setCodigo] = useState(codigoInicial ?? '');
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [escaneando, setEscaneando] = useState(false);
  const [permisoCamara, pedirPermisoCamara] = useCameraPermissions();

  async function activar(valor = codigo) {
    setCargando(true);
    setError(null);
    try {
      await asegurarSesion();
      const dispositivo = Application.getAndroidId() ?? 'desconocido';
      const { data, error } = await supabase.rpc('activar_invitacion', { p_codigo: valor, p_dispositivo: dispositivo });
      if (error) throw error;
      await alActivar(data as Viaje);
    } catch (err) {
      setError(mensajeSimple(err, 'No se pudo activar el código. Revíselo o pida uno nuevo a despacho.'));
    } finally {
      setCargando(false);
    }
  }

  async function abrirEscaner() {
    if (!permisoCamara?.granted) {
      const r = await pedirPermisoCamara();
      if (!r.granted) {
        setError('Sin permiso de cámara. Escriba el código a mano.');
        return;
      }
    }
    setEscaneando(true);
  }

  if (escaneando) {
    return (
      <View style={{ flex: 1 }}>
        <CameraView
          style={{ flex: 1 }}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={({ data }) => {
            const leido = extraerCodigo(data);
            setEscaneando(false);
            setCodigo(leido);
            void activar(leido);
          }}
        />
        <View style={{ padding: 16 }}>
          <Boton texto="Cancelar" variante="cafe" onPress={() => setEscaneando(false)} />
        </View>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={e.contenido} keyboardShouldPersistTaps="handled">
      <Image source={require('../../assets/logo.png')} style={e.logo} />
      <Text style={e.titulo}>Activar viaje</Text>
      <Text style={e.texto}>Escriba el código de 8 letras que le envió despacho por WhatsApp o escanee el QR de la guía.</Text>
      <TextInput
        style={e.entrada}
        value={codigo}
        onChangeText={(t) => setCodigo(extraerCodigo(t))}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={8}
        placeholder="ABCD2345"
      />
      {error && <Text style={e.error}>{error}</Text>}
      <Boton texto="Activar" onPress={() => activar()} deshabilitado={codigo.length !== 8} cargando={cargando} />
      <Boton texto="Escanear QR" variante="dorado" onPress={abrirEscaner} />
    </ScrollView>
  );
}
