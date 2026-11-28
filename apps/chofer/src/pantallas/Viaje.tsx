import { useCallback, useEffect, useState } from 'react';
import { Alert, Image, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { ETIQUETA_ETAPA, MARCA, type Etapa, type EtapaChofer } from '@reynales/shared';
import { supabase } from '../supabase';
import { Boton } from '../componentes';
import { e, F } from '../estilos';
import { contarPendientes, vaciarCola } from '../cola';
import { guardarEstado, leerEstado, type EstadoRastreo } from '../estado';
import { enviarTodo } from '../envio';
import { detenerRastreo, iniciarRastreo, rastreoActivo, type ResultadoPermisos } from '../rastreo';
import type { Viaje as TViaje } from '../tipos';
import { mensajeSimple } from '../mensajes';
import Emergencia from '../Emergencia';
import AjustesTelefono from './AjustesTelefono';

const VELOCIDAD_BLOQUEO_KMH = 10;
// Una velocidad más vieja que esto no bloquea los botones (el GPS pudo perder señal con el camión en marcha).
const VELOCIDAD_VIGENTE_MS = 2 * 60 * 1000;


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
  // Paso obligatorio de revisión de ajustes antes de "Iniciar viaje".
  const [revisando, setRevisando] = useState(false);

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
      if (!['programado', 'entregado', 'cancelado'].includes(viaje.etapa) && !s.sinAcceso) {
        const permisos = await iniciarRastreo();
        if (permisos !== 'ok') setError(MENSAJE_PERMISOS[permisos]);
      }
      await refrescar();
    })();
    const reloj = setInterval(refrescar, 5000);
    return () => clearInterval(reloj);
  }, [viaje, refrescar]);

  const velocidadVigente =
    estado?.ultimoGuardado != null && Date.now() - estado.ultimoGuardado.t < VELOCIDAD_VIGENTE_MS;
  const enMovimiento = velocidadVigente && (estado?.ultimaVelocidadKmh ?? 0) > VELOCIDAD_BLOQUEO_KMH && activo;

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
      // Antes de entregar se intenta enviar todo lo pendiente (lo que quede se envía después).
      const quedan = nueva === 'entregado' ? await enviarTodo() : 0;

      // Se envía también la hora del teléfono: el servidor guarda ambas (la suya y esta).
      const { error } = await supabase.rpc('marcar_etapa_chofer', {
        p_asignacion: viaje.asignacion_id,
        p_etapa: nueva,
        p_hora_dispositivo: new Date().toISOString(),
      });
      if (error) throw new Error(error.message);
      await guardarEstado({ etapa: nueva });
      setEtapa(nueva);

      if (nueva === 'entregado') {
        await detenerRastreo();
        await guardarEstado({ viaje: null });
        Alert.alert(
          viaje.transbordo ? 'Carga entregada en transbordo' : 'Viaje entregado',
          quedan > 0
            ? `Gracias. El rastreo se detuvo. Quedan ${quedan} ubicaciones guardadas: se enviarán solas la próxima vez que abra la app con señal.`
            : 'Gracias. El rastreo se detuvo.',
        );
        alTerminar();
      }
    } catch (err) {
      if (nueva === 'cargado') {
        // El viaje no se inició: se apaga el GPS y se borra lo capturado (privacidad del chofer).
        await detenerRastreo();
        await vaciarCola();
      }
      setError(mensajeSimple(err, 'No se pudo registrar. Intente de nuevo.'));
    } finally {
      setCargando(false);
      await refrescar();
    }
  }

  // Confirmación dentro de la pantalla (botones grandes, legibles al sol).
  // Dos pasos: el chofer pulsa el botón y luego confirma el mensaje.
  const [confirmando, setConfirmando] = useState<{ etapa: EtapaChofer } | null>(null);

  function pedir(nueva: EtapaChofer) {
    setError(null);
    if (nueva === 'cargado') {
      setRevisando(true); // primero los ajustes del teléfono, luego la confirmación
      return;
    }
    setConfirmando({ etapa: nueva });
  }

  function aceptarPaso() {
    if (!confirmando) return;
    const nueva = confirmando.etapa;
    setConfirmando(null);
    void marcar(nueva);
  }

  const textoConfirmacion = (() => {
    if (!confirmando) return null;
    if (confirmando.etapa === 'cargado') {
      return {
        titulo: `¿Iniciar el viaje a ${viaje.destino}?`,
        detalle: 'Desde ahora la app registrará la ubicación del camión hasta que marque la entrega.',
        si: 'Sí, iniciar viaje',
      };
    }
    if (confirmando.etapa === 'en_frontera') {
      return {
        titulo: '¿Llegó a la frontera?',
        detalle: 'Despacho verá que el camión está en trámite de frontera.',
        si: 'Sí, estoy en frontera',
      };
    }
    if (viaje.transbordo) {
      return {
        titulo: '¿Entregó la carga en el transbordo?',
        detalle: 'Confirme que la carga ya pasó al otro camión. Al confirmar se cierra su viaje y se detiene el rastreo.',
        si: 'Sí, entregué en transbordo',
      };
    }
    return {
      titulo: '¿Confirma la entrega?',
      detalle: `Confirme que entregó la carga en ${viaje.destino}. Al confirmar se cierra el viaje y se detiene el rastreo.`,
      si: 'Sí, confirmo la entrega',
    };
  })();

  // Solo se ofrece el siguiente paso lógico como botón principal.
  const haciaPeru = viaje.destino_pais === 'PE';
  const enCamino = etapa === 'cargado' || etapa === 'en_ruta';
  const siguiente: { etapa: EtapaChofer; texto: string; variante: 'verde' | 'dorado' } | null =
    etapa === 'programado'
      ? { etapa: 'cargado', texto: 'Iniciar viaje', variante: 'verde' }
      : enCamino && haciaPeru
        ? { etapa: 'en_frontera', texto: 'Llegué a frontera', variante: 'dorado' }
        : enCamino || etapa === 'en_frontera' || etapa === 'cruzo_frontera'
          ? { etapa: 'entregado', texto: viaje.transbordo ? 'Entregué en transbordo' : 'Entregado', variante: 'verde' }
          : null;
  // Si un viaje a Perú no pasó por "frontera" (por ejemplo, ya cruzó), la entrega sigue disponible como opción secundaria.
  const entregaSecundaria = enCamino && haciaPeru;

  // El indicador muestra cuándo llegó realmente el último envío a despacho.
  const minDesdeEnvio = estado?.ultimoEnvio ? Math.floor((Date.now() - estado.ultimoEnvio) / 60000) : null;
  const textoUltimoEnvio =
    minDesdeEnvio === null ? 'Aún no se envió ninguna ubicación' : minDesdeEnvio < 1 ? 'Último envío: hace menos de 1 min' : `Último envío: hace ${minDesdeEnvio} min`;
  const estadoTexto = !activo
    ? { texto: 'Rastreo detenido', color: MARCA.gris }
    : estado?.ultimoEnvioOk === false || pendientes > 20
      ? { texto: `Guardando sin señal (${pendientes} puntos)`, color: MARCA.dorado }
      : minDesdeEnvio === null || minDesdeEnvio > 10
        ? { texto: 'Esperando enviar ubicación', color: MARCA.dorado }
        : { texto: 'Enviando ubicación', color: MARCA.verde };
  const mb = ((estado?.bytesUsados ?? 0) / (1024 * 1024)).toFixed(2);
  const viajeAbierto = etapa !== 'entregado' && etapa !== 'cancelado' && !estado?.sinAcceso;

  if (revisando) {
    return (
      <AjustesTelefono
        alVolver={() => setRevisando(false)}
        alContinuar={() => {
          setRevisando(false);
          setConfirmando({ etapa: 'cargado' });
        }}
      />
    );
  }

  return (
    <View style={e.pantalla}>
      <ScrollView contentContainerStyle={e.contenido}>
        <Image source={require('../../assets/logo.png')} style={[e.logo, { height: 50 }]} />
        <View style={e.tarjeta}>
          <Text style={e.etiqueta}>Misión {viaje.mision_codigo}</Text>
          <Text style={e.titulo}>{viaje.destino}</Text>
          <Text style={e.texto}>Placa {viaje.placa} · {viaje.conductor}</Text>
          <Text style={[e.texto, { fontFamily: F.negrita, color: MARCA.verdeOscuro }]}>{ETIQUETA_ETAPA[etapa]}</Text>
        </View>

        <View style={[e.tarjeta, { flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
          <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: estadoTexto.color }} />
          <View style={{ flex: 1 }}>
            <Text style={e.etiqueta}>{estadoTexto.texto}</Text>
            {activo && <Text style={e.textoChico}>{textoUltimoEnvio}</Text>}
            <Text style={e.textoChico}>Datos usados en este viaje: {mb} MB{estado?.modoPeru ? ' · modo Perú (ahorro de roaming)' : ''}</Text>
          </View>
        </View>

        {viajeAbierto && <Emergencia viaje={viaje} enPeru={etapa === 'cruzo_frontera' || !!estado?.modoPeru} />}

        {error && <Text style={e.error}>{error}</Text>}

        {estado?.sinAcceso && (
          <View style={[e.tarjeta, { borderColor: MARCA.dorado, borderWidth: 2 }]}>
            <Text style={e.titulo}>Avise a despacho</Text>
            <Text style={e.texto}>
              Este teléfono perdió el acceso al viaje y el rastreo se detuvo. Pida a despacho un código nuevo y actívelo.
            </Text>
          </View>
        )}

        {enMovimiento ? (
          <View style={[e.tarjeta, { backgroundColor: MARCA.cafe }]}>
            <Text style={[e.titulo, { color: MARCA.blanco }]}>Conduzca con seguridad</Text>
            <Text style={[e.texto, { color: MARCA.blanco }]}>Los botones se habilitan cuando el camión se detiene.</Text>
          </View>
        ) : (
          <View style={{ gap: 12 }}>
            {confirmando && textoConfirmacion ? (
              <View style={[e.tarjeta, { borderColor: MARCA.dorado, borderWidth: 2, gap: 12 }]}>
                <Text style={e.titulo}>{textoConfirmacion.titulo}</Text>
                <Text style={e.texto}>{textoConfirmacion.detalle}</Text>
                <Boton texto={textoConfirmacion.si} onPress={aceptarPaso} cargando={cargando} />
                <Boton texto="Cancelar" variante="cafe" onPress={() => setConfirmando(null)} />
              </View>
            ) : (
              <>
                {siguiente && (
                  <Boton texto={siguiente.texto} variante={siguiente.variante} onPress={() => pedir(siguiente.etapa)} cargando={cargando} />
                )}
                {entregaSecundaria && (
                  <Pressable onPress={() => pedir('entregado')} accessibilityRole="button" style={{ paddingVertical: 14, alignItems: 'center' }}>
                    <Text style={[e.etiqueta, { textDecorationLine: 'underline' }]}>Ya entregué la carga</Text>
                  </Pressable>
                )}
                {viaje.telefono_coordinador && (
                  <Boton
                    texto="WhatsApp al coordinador"
                    variante="cafe"
                    onPress={() => Linking.openURL(`https://wa.me/${viaje.telefono_coordinador!.replace(/[^0-9]/g, '')}`)}
                  />
                )}
                <Boton texto="Ajustes del teléfono" variante="cafe" onPress={alAbrirAjustes} />
              </>
            )}
          </View>
        )}
        <Text style={e.textoChico}>
          La ubicación se registra solo entre “Iniciar viaje” y “Entregado”. Sin señal, se guarda en el teléfono y se envía al recuperarla.
        </Text>
      </ScrollView>
    </View>
  );
}
