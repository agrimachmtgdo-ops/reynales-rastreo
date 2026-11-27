import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { supabase } from '../supabase';
import { Boton } from '../componentes';
import { e } from '../estilos';
import type { Viaje } from '../tipos';

export default function Consentimiento({ viaje, alAceptar }: { viaje: Viaje; alAceptar: (v: Viaje) => void }) {
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function aceptar() {
    if (!viaje.politica) return;
    setCargando(true);
    setError(null);
    const { data, error } = await supabase.rpc('aceptar_politica', {
      p_asignacion: viaje.asignacion_id,
      p_version: viaje.politica.version,
    });
    setCargando(false);
    if (error) {
      setError(error.message);
      return;
    }
    alAceptar(data as Viaje);
  }

  return (
    <View style={e.pantalla}>
      <ScrollView contentContainerStyle={e.contenido}>
        <Text style={e.titulo}>Condiciones de rastreo</Text>
        <Text style={e.textoChico}>Misión {viaje.mision_codigo} · Placa {viaje.placa}</Text>
        <View style={e.tarjeta}>
          <Text style={e.texto}>{viaje.politica?.texto ?? 'No hay una política vigente. Comuníquese con despacho.'}</Text>
        </View>
        {error && <Text style={e.error}>{error}</Text>}
        <Boton texto="Acepto" onPress={aceptar} cargando={cargando} deshabilitado={!viaje.politica} />
      </ScrollView>
    </View>
  );
}
