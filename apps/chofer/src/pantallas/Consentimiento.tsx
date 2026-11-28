import { useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { MARCA } from '@reynales/shared';
import { supabase } from '../supabase';
import { Boton } from '../componentes';
import { e, F } from '../estilos';
import { mensajeSimple } from '../mensajes';
import type { Viaje } from '../tipos';

// Lo esencial de la política, en palabras simples (el texto completo va debajo).
const RESUMEN = [
  'Su ubicación se registra SOLO entre «Iniciar viaje» y «Entregado».',
  'La ve el personal de despacho de Industrias Reynales. El cliente ve el camión, nunca su nombre ni su teléfono.',
  'No se leen sus contactos, fotos, mensajes ni llamadas. Gasta pocos datos (menos de 3 MB por día).',
];

export default function Consentimiento({ viaje, alAceptar }: { viaje: Viaje; alAceptar: (v: Viaje) => void }) {
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verTodo, setVerTodo] = useState(false);
  const [rechazado, setRechazado] = useState(false);

  async function aceptar() {
    if (!viaje.politica) return;
    setCargando(true);
    setError(null);
    try {
      const { data, error } = await supabase.rpc('aceptar_politica', {
        p_asignacion: viaje.asignacion_id,
        p_version: viaje.politica.version,
      });
      if (error) throw error;
      alAceptar(data as Viaje);
    } catch (err) {
      setError(mensajeSimple(err, 'No se pudo registrar su aceptación. Intente de nuevo.'));
    } finally {
      setCargando(false);
    }
  }

  const telefono = viaje.telefono_coordinador?.replace(/[^0-9+]/g, '') ?? '';

  if (rechazado) {
    return (
      <ScrollView contentContainerStyle={e.contenido}>
        <Text style={e.titulo}>No aceptó las condiciones</Text>
        <Text style={e.texto}>
          Sin aceptar las condiciones de rastreo la app no puede registrar este viaje. Hable con despacho para coordinar otra forma de seguimiento.
        </Text>
        {telefono !== '' && (
          <>
            <Boton texto="Llamar a despacho" onPress={() => void Linking.openURL(`tel:${telefono}`)} />
            <Boton texto="WhatsApp a despacho" variante="cafe" onPress={() => void Linking.openURL(`https://wa.me/${telefono.replace('+', '')}`)} />
          </>
        )}
        <Boton texto="Volver a leer las condiciones" variante="dorado" onPress={() => setRechazado(false)} />
      </ScrollView>
    );
  }

  return (
    <View style={e.pantalla}>
      <ScrollView contentContainerStyle={e.contenido}>
        <Text style={e.titulo}>Condiciones de rastreo</Text>
        <Text style={e.textoChico}>Misión {viaje.mision_codigo} · Placa {viaje.placa}</Text>
        {viaje.politica ? (
          <>
            <View style={[e.tarjeta, { gap: 10 }]}>
              {RESUMEN.map((punto, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: 10 }}>
                  <Text style={{ fontFamily: F.negrita, fontSize: 16, color: MARCA.verdeOscuro }}>{i + 1}.</Text>
                  <Text style={[e.texto, { flex: 1 }]}>{punto}</Text>
                </View>
              ))}
            </View>
            <Pressable onPress={() => setVerTodo(!verTodo)} accessibilityRole="button" style={{ paddingVertical: 8 }}>
              <Text style={[e.etiqueta, { textDecorationLine: 'underline' }]}>{verTodo ? 'Ocultar el texto completo' : 'Leer el texto completo'}</Text>
            </Pressable>
            {verTodo && (
              <View style={e.tarjeta}>
                <Text style={e.texto}>{viaje.politica.texto}</Text>
              </View>
            )}
          </>
        ) : (
          <View style={e.tarjeta}>
            <Text style={e.texto}>No hay condiciones vigentes. Comuníquese con despacho.</Text>
          </View>
        )}
        {error && <Text style={e.error}>{error}</Text>}
        <Boton texto="Acepto" onPress={aceptar} cargando={cargando} deshabilitado={!viaje.politica} />
        <Pressable onPress={() => setRechazado(true)} accessibilityRole="button" style={{ paddingVertical: 14, alignItems: 'center' }}>
          <Text style={[e.etiqueta, { textDecorationLine: 'underline' }]}>No acepto</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
