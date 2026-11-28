import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, Text, View } from 'react-native';
import * as Location from 'expo-location';
import { MARCA } from '@reynales/shared';
import { supabase } from './supabase';
import { leerEstado } from './estado';
import { e, F } from './estilos';
import type { Viaje } from './tipos';

type Paso = 'cerrado' | 'eligiendo' | 'enviando' | 'enviada' | 'fallo';

const MOTIVOS: { id: string; texto: string }[] = [
  { id: 'accidente', texto: 'Accidente' },
  { id: 'robo', texto: 'Robo o asalto' },
  { id: 'mecanica', texto: 'Falla mecánica' },
  { id: 'salud', texto: 'Problema de salud' },
  { id: 'otro', texto: 'Otra emergencia' },
];

// Números de emergencia de cada país.
const NUMEROS = {
  BO: [{ texto: 'Policía 110', tel: '110' }, { texto: 'Ambulancia 118', tel: '118' }],
  PE: [{ texto: 'Policía 105', tel: '105' }, { texto: 'Ambulancia 106', tel: '106' }],
};

const REINTENTO_MS = 30_000;
const MAX_REINTENTOS = 20;

/** Ubicación lo más rápido posible: la última conocida o una nueva (máx. 8 s). */
async function ubicacionRapida(): Promise<{ lat: number; lon: number } | null> {
  try {
    const ultima = await Location.getLastKnownPositionAsync({ maxAge: 10 * 60 * 1000 });
    if (ultima) return { lat: ultima.coords.latitude, lon: ultima.coords.longitude };
    const actual = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((r) => setTimeout(() => r(null), 8000)),
    ]);
    if (actual) return { lat: actual.coords.latitude, lon: actual.coords.longitude };
  } catch {
    /* sin permiso o sin GPS */
  }
  const s = await leerEstado();
  return s.ultimoGuardado ? { lat: s.ultimoGuardado.lat, lon: s.ultimoGuardado.lon } : null;
}

function BotonLlamar({ texto, tel }: { texto: string; tel: string }) {
  return (
    <Pressable
      onPress={() => void Linking.openURL(`tel:${tel}`)}
      accessibilityRole="button"
      style={{ borderWidth: 2, borderColor: MARCA.rojo, borderRadius: 12, paddingVertical: 14, alignItems: 'center', backgroundColor: MARCA.blanco }}
    >
      <Text style={{ fontFamily: F.negrita, fontSize: 17, color: MARCA.rojo }}>{texto}</Text>
    </Pressable>
  );
}

/**
 * Botón rojo de emergencia, siempre visible durante el viaje (también en movimiento).
 * Dos toques: "Emergencia" y luego el motivo. Si no hay señal, reintenta solo y ofrece llamar.
 */
export default function Emergencia({ viaje, enPeru }: { viaje: Viaje; enPeru: boolean }) {
  const [paso, setPaso] = useState<Paso>('cerrado');
  const [motivo, setMotivo] = useState<string | null>(null);
  const reintentos = useRef(0);
  const reloj = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (reloj.current) clearTimeout(reloj.current);
  }, []);

  async function enviar(m: string) {
    setMotivo(m);
    setPaso('enviando');
    const donde = await ubicacionRapida();
    const { error } = await supabase.rpc('reportar_emergencia', {
      p_asignacion: viaje.asignacion_id,
      p_motivo: m,
      p_lat: donde?.lat ?? null,
      p_lon: donde?.lon ?? null,
    });
    if (!error) {
      reintentos.current = 0;
      setPaso('enviada');
      return;
    }
    setPaso('fallo');
    // Sin señal: se reintenta solo cada 30 s mientras la pantalla esté abierta.
    if (reintentos.current < MAX_REINTENTOS) {
      reintentos.current += 1;
      reloj.current = setTimeout(() => void enviar(m), REINTENTO_MS);
    }
  }

  function cerrar() {
    if (reloj.current) clearTimeout(reloj.current);
    reintentos.current = 0;
    setPaso('cerrado');
    setMotivo(null);
  }

  const numeros = enPeru ? NUMEROS.PE : NUMEROS.BO;
  const llamadas = (
    <View style={{ gap: 8 }}>
      {viaje.telefono_coordinador && <BotonLlamar texto="Llamar a despacho" tel={viaje.telefono_coordinador.replace(/[^0-9+]/g, '')} />}
      {numeros.map((n) => <BotonLlamar key={n.tel} texto={n.texto} tel={n.tel} />)}
    </View>
  );

  if (paso === 'cerrado') {
    return (
      <Pressable
        onPress={() => setPaso('eligiendo')}
        accessibilityRole="button"
        accessibilityLabel="Emergencia"
        accessibilityHint="Abre las opciones para avisar una emergencia a despacho"
        style={{ backgroundColor: MARCA.rojo, borderRadius: 12, paddingVertical: 16, alignItems: 'center' }}
      >
        <Text style={{ fontFamily: F.negrita, fontSize: 18, color: MARCA.blanco, letterSpacing: 1 }}>EMERGENCIA</Text>
      </Pressable>
    );
  }

  return (
    <View style={[e.tarjeta, { borderColor: MARCA.rojo, borderWidth: 2, gap: 10 }]}>
      {paso === 'eligiendo' && (
        <>
          <Text style={[e.titulo, { color: MARCA.rojo }]}>¿Qué pasó?</Text>
          <Text style={e.texto}>Toque una opción. Despacho recibirá el aviso con su ubicación.</Text>
          {MOTIVOS.map((m) => (
            <Pressable
              key={m.id}
              onPress={() => void enviar(m.id)}
              accessibilityRole="button"
              style={{ backgroundColor: MARCA.rojo, borderRadius: 12, paddingVertical: 15, alignItems: 'center' }}
            >
              <Text style={{ fontFamily: F.negrita, fontSize: 17, color: MARCA.blanco }}>{m.texto}</Text>
            </Pressable>
          ))}
          {llamadas}
          <Pressable onPress={cerrar} accessibilityRole="button" style={{ paddingVertical: 12, alignItems: 'center' }}>
            <Text style={[e.etiqueta, { textDecorationLine: 'underline' }]}>Cancelar, no es una emergencia</Text>
          </Pressable>
        </>
      )}
      {paso === 'enviando' && (
        <View style={{ alignItems: 'center', gap: 8, paddingVertical: 12 }}>
          <ActivityIndicator size="large" color={MARCA.rojo} />
          <Text style={e.texto}>Enviando aviso a despacho…</Text>
        </View>
      )}
      {paso === 'enviada' && (
        <>
          <Text style={[e.titulo, { color: MARCA.verdeOscuro }]}>Aviso recibido</Text>
          <Text style={e.texto}>Despacho ya sabe que tiene una emergencia ({MOTIVOS.find((m) => m.id === motivo)?.texto}). Le contactarán. Si corre peligro, llame ahora:</Text>
          {llamadas}
          <Pressable onPress={cerrar} accessibilityRole="button" style={{ paddingVertical: 12, alignItems: 'center' }}>
            <Text style={[e.etiqueta, { textDecorationLine: 'underline' }]}>Cerrar</Text>
          </Pressable>
        </>
      )}
      {paso === 'fallo' && (
        <>
          <Text style={[e.titulo, { color: MARCA.rojo }]}>No hay señal para enviar el aviso</Text>
          <Text style={e.texto}>
            La app lo reintentará sola cada 30 segundos. Las llamadas pueden funcionar aunque no haya internet:
          </Text>
          {llamadas}
          {motivo && (
            <Pressable onPress={() => void enviar(motivo)} accessibilityRole="button" style={{ paddingVertical: 12, alignItems: 'center' }}>
              <Text style={[e.etiqueta, { textDecorationLine: 'underline' }]}>Reintentar ahora</Text>
            </Pressable>
          )}
          <Pressable onPress={cerrar} accessibilityRole="button" style={{ paddingVertical: 8, alignItems: 'center' }}>
            <Text style={[e.etiqueta, { textDecorationLine: 'underline' }]}>Cancelar el aviso</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}
