import { useCallback, useEffect, useState } from 'react';
import { Alert, Image, Linking, ScrollView, Text, View } from 'react-native';
import { ETIQUETA_ETAPA, MARCA, type Etapa, type EtapaChofer } from '@reynales/shared';
import { supabase } from '../supabase';
import { Boton } from '../componentes';
import { e, F } from '../estilos';
import { contarPendientes, vaciarCola } from '../cola';
import { guardarEstado, leerEstado, type EstadoRastreo } from '../estado';
import { enviarPendientes } from '../envio';
import { detenerRastreo, iniciarRastreo, rastreoActivo, type ResultadoPermisos } from '../rastreo';
import type { Viaje as TViaje } from '../tipos';

const VELOCIDAD_BLOQUEO_KMH = 10;

const MENSAJE_PERMISOS: Record<Exclude<ResultadoPermisos, 'ok'>, string> = {
  gps_apagado: 'El GPS está apagado. Enciéndalo e intente de nuevo.',
  sin_permiso: 'Sin permiso de ubicación no se puede iniciar el viaje.',
  sin_segundo_plano: 'Elija "Permitir todo el tiempo" en la ubicación para que el rastreo siga con la pantalla apagada.',
};

export default function Viaje({
  viaje,
  alTerminar,
  alAbrirAjustes,
}: {
  viaje: TViaje;
  alTerminar: () => void;
  alAbrirAjustes: () => void;
}) {
  const [etapa, setEtapa] = useState<Etapa>(viaje.etapa);
  const [estado, setEstado] = useState<EstadoRastreo | null>(null);
  const [pendientes, setPendientes] = useState(0);
  const [activo, setActivo] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refrescar = useCallback(async () => {
    const s = await leerEstado();
    setEstado(s);
    if (s.etapa) setEtapa(s.etapa);
    setPendientes(await contarPendientes());
    setActivo(await rastreoActivo());
  }, []);

  // Al abrir: si el viaje ya estaba iniciado, se asegura que el GPS siga encendido.
  useEffect(() => {
    void (async () => {
      const s = await leerEstado();
      if (s.asignacionId !== viaje.asignacion_id) {
        await vaciarCola();
        await guardarEstado({ asignacionId: viaje.asignacion_id, etapa: viaje.etapa, bytesUsados: 0, modoPeru: viaje.etapa === 'cruzo_frontera' });
      }
      if (!['programado', 'entregado', 'cancelado'].includes(viaje.etapa)) {
        await iniciarRastreo();
      }
      await refrescar();
    })();
    const reloj = setInterval(refrescar, 5000);
    return () => clearInterval(reloj);
  }, [viaje, refrescar]);

  const enMovimiento = (estado?.ultimaVelocidadKmh ?? 0) > VELOCIDAD_BLOQUEO_KMH && activo;

  async function marcar(nueva: EtapaChofer) {
    setCargando(true);
    setError(null);
    try {
      if (nueva === 'cargado') {
        const permisos = await iniciarRastreo();
        if (permisos !== 'ok') {
          setError(MENSAJE_PERMISOS[permisos]);
          return;
        }
      }
      // Antes de entregar se envía todo lo pendiente.
      if (nueva === 'entregado') await enviarPendientes(true);

      const { error } = await supabase.rpc('marcar_etapa_chofer', { p_asignacion: viaje.asignacion_id, p_etapa: nueva });
      if (error) throw new Error(error.message);
      await guardarEstado({ etapa: nueva });
      setEtapa(nueva);

      if (nueva === 'entregado') {
        await detenerRastreo();
        Alert.alert('Viaje entregado', 'Gracias. El rastreo se detuvo.');
        alTerminar();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar. Revise su señal.');
    } finally {
      setCargando(false);
      await refrescar();
    }
  }

  function confirmar(titulo: string, nueva: EtapaChofer) {
    Alert.alert(titulo, '¿Confirma?', [
      { text: 'No', style: 'cancel' },
      { text: 'Sí', onPress: () => void marcar(nueva) },
    ]);
  }

  const estadoTexto = !activo
    ? { texto: 'Rastreo detenido', color: MARCA.gris }
    : estado?.ultimoEnvioOk === false || pendientes > 20
      ? { texto: `Guardando sin señal (${pendientes} puntos)`, color: MARCA.dorado }
      : { texto: 'Enviando ubicación', color: MARCA.verde };
  const mb = ((estado?.bytesUsados ?? 0) / (1024 * 1024)).toFixed(2);

  return (
    <View style={e.pantalla}>
      <ScrollView contentContainerStyle={e.contenido}>
        <Image source={require('../../assets/logo.png')} style={[e.logo, { height: 50 }]} />
        <View style={e.tarjeta}>
          <Text style={e.etiqueta}>Misión {viaje.mision_codigo}</Text>
          <Text style={e.titulo}>{viaje.destino}</Text>
          <Text style={e.texto}>Placa {viaje.placa} · {viaje.conductor}</Text>
          <Text style={[e.texto, { fontFamily: F.negrita, color: MARCA.verde }]}>{ETIQUETA_ETAPA[etapa]}</Text>
        </View>

        <View style={[e.tarjeta, { flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
          <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: estadoTexto.color }} />
          <View style={{ flex: 1 }}>
            <Text style={e.etiqueta}>{estadoTexto.texto}</Text>
            <Text style={e.textoChico}>Datos usados en este viaje: {mb} MB{estado?.modoPeru ? ' · modo Perú (ahorro de roaming)' : ''}</Text>
          </View>
        </View>

        {error && <Text style={e.error}>{error}</Text>}

        {enMovimiento ? (
          <View style={[e.tarjeta, { backgroundColor: MARCA.cafe }]}>
            <Text style={[e.titulo, { color: MARCA.blanco }]}>Conduzca con seguridad</Text>
            <Text style={[e.texto, { color: MARCA.blanco }]}>Los botones se habilitan cuando el camión se detiene.</Text>
          </View>
        ) : (
          <View style={{ gap: 12 }}>
            {etapa === 'programado' && <Boton texto="Iniciar viaje" onPress={() => confirmar('Iniciar viaje', 'cargado')} cargando={cargando} />}
            {(etapa === 'cargado' || etapa === 'en_ruta') && viaje.destino_pais === 'PE' && (
              <Boton texto="Llegué a frontera" variante="dorado" onPress={() => confirmar('Llegué a frontera', 'en_frontera')} cargando={cargando} />
            )}
            {['cargado', 'en_ruta', 'en_frontera', 'cruzo_frontera'].includes(etapa) && (
              <Boton texto="Entregado" onPress={() => confirmar('Marcar como entregado', 'entregado')} cargando={cargando} />
            )}
            {viaje.telefono_coordinador && (
              <Boton
                texto="WhatsApp al coordinador"
                variante="cafe"
                onPress={() => Linking.openURL(`https://wa.me/${viaje.telefono_coordinador!.replace(/[^0-9]/g, '')}`)}
              />
            )}
            <Boton texto="Ajustes del teléfono" variante="cafe" onPress={alAbrirAjustes} />
          </View>
        )}
        <Text style={e.textoChico}>
          La ubicación se registra solo entre “Iniciar viaje” y “Entregado”. Sin señal, se guarda en el teléfono y se envía al recuperarla.
        </Text>
      </ScrollView>
    </View>
  );
}
