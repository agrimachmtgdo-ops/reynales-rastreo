import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { MARCA } from '@reynales/shared';
import { supabase } from '../supabase';
import { Boton } from '../componentes';
import { e, F } from '../estilos';
import { enviarTodo } from '../envio';
import { mensajeSimple } from '../mensajes';
import { borrarFotoLocal, encolarFotos, guardarFotoLocal, rutaFoto, subirFotosPendientes } from '../fotosEntrega';
import type { Viaje } from '../tipos';

type Presentacion = 'saco_50' | 'saco_40' | 'big_bag_1200' | 'granel' | 'mixta' | null;
type Novedad = 'sin_novedad' | 'faltante' | 'dano' | 'humedad' | 'otra';

interface Esperado {
  mision_id: string;
  presentacion: Presentacion;
  unidades: number | null;
  kg: number | null;
  estimado: boolean;
  tolerancia_pct: number;
}

const KG_UNIDAD: Partial<Record<NonNullable<Presentacion>, number>> = { saco_50: 50, saco_40: 40, big_bag_1200: 1200 };
const NOMBRE_UNIDAD: Partial<Record<NonNullable<Presentacion>, [string, string]>> = {
  saco_50: ['saco de 50 kg', 'sacos de 50 kg'],
  saco_40: ['saco de 40 kg', 'sacos de 40 kg'],
  big_bag_1200: ['big bag', 'big bags'],
};
const NOVEDADES: { id: Novedad; texto: string }[] = [
  { id: 'sin_novedad', texto: 'Sin novedad' },
  { id: 'faltante', texto: 'Faltante' },
  { id: 'dano', texto: 'Daño' },
  { id: 'humedad', texto: 'Humedad' },
  { id: 'otra', texto: 'Otra' },
];
const MAX_FOTOS_NOVEDAD = 2;
// Lado mayor buscado para las fotos: la guía se lee bien y cada foto pesa poco (datos del chofer).
const LADO_FOTO = 1600;

const miles = (n: number) => n.toLocaleString('es-BO', { maximumFractionDigits: 1 });

function textoCarga(esp: Esperado) {
  const nombres = esp.presentacion ? NOMBRE_UNIDAD[esp.presentacion] : undefined;
  const kg = esp.kg != null ? `${miles(esp.kg)} kg` : null;
  if (nombres && esp.unidades != null) {
    return `${esp.estimado ? 'Unos ' : ''}${miles(esp.unidades)} ${esp.unidades === 1 ? nombres[0] : nombres[1]}${kg ? ` (${kg})` : ''}`;
  }
  return kg ?? 'Sin peso registrado';
}

/** Cámara a pantalla completa para una foto (guía o novedad). */
function Camara({ titulo, alTomar, alCancelar }: { titulo: string; alTomar: (uri: string) => void; alCancelar: () => void }) {
  const camara = useRef<CameraView>(null);
  const [tamano, setTamano] = useState<string | undefined>();
  const [listo, setListo] = useState(false);
  const [tomando, setTomando] = useState(false);

  async function alEstarLista() {
    try {
      const tamanos = (await camara.current?.getAvailablePictureSizesAsync()) ?? [];
      const medidos = tamanos
        .map((t) => ({ t, lado: Math.max(...t.split('x').map(Number)) }))
        .filter((m) => Number.isFinite(m.lado))
        .sort((a, b) => a.lado - b.lado);
      const elegido = medidos.find((m) => m.lado >= LADO_FOTO) ?? medidos[medidos.length - 1];
      if (elegido) setTamano(elegido.t);
    } catch { /* se usa el tamaño por defecto */ }
    setListo(true);
  }

  async function tomar() {
    if (!camara.current || tomando) return;
    setTomando(true);
    try {
      const foto = await camara.current.takePictureAsync({ quality: 0.6, exif: false, shutterSound: false });
      if (foto?.uri) alTomar(foto.uri);
    } finally {
      setTomando(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <Text style={[e.etiqueta, { color: MARCA.blanco, padding: 12, fontSize: 16 }]}>{titulo}</Text>
      <CameraView ref={camara} style={{ flex: 1 }} facing="back" pictureSize={tamano} onCameraReady={() => void alEstarLista()} />
      <View style={{ padding: 16, gap: 12 }}>
        <Boton texto="Tomar foto" onPress={() => void tomar()} cargando={tomando} deshabilitado={!listo} />
        <Boton texto="Cancelar" variante="cafe" onPress={alCancelar} />
      </View>
    </View>
  );
}

function Opcion({ texto, activa, onPress }: { texto: string; activa: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected: activa }}
      style={{
        paddingVertical: 12, paddingHorizontal: 16, borderRadius: 10, borderWidth: 2,
        borderColor: activa ? MARCA.verdeOscuro : '#D8CCB6', backgroundColor: activa ? '#E3F3E8' : MARCA.blanco,
      }}
    >
      <Text style={{ fontFamily: activa ? F.negrita : F.semi, fontSize: 16, color: MARCA.cafe }}>{texto}</Text>
    </Pressable>
  );
}

const estiloCampo = { backgroundColor: MARCA.blanco, borderWidth: 2, borderColor: '#D8CCB6', borderRadius: 10,
  paddingVertical: 12, paddingHorizontal: 14, fontFamily: F.semi, fontSize: 17, color: MARCA.cafe } as const;

/**
 * Prueba de entrega (último tramo): quién recibió, cuánto, novedad con fotos y la foto de la
 * guía firmada. Al confirmar se registra la prueba y el viaje queda «Entregado»; las fotos
 * se suben después si no hay señal.
 */
export default function Entrega({
  viaje, alVolver, alRegistrada, alSinPrueba,
}: {
  viaje: Viaje;
  alVolver: () => void;
  /** La entrega quedó registrada. quedan = ubicaciones sin enviar; fotos = fotos por subir. */
  alRegistrada: (r: { quedan: number; fotos: number }) => void;
  /** El servidor aún no tiene la prueba de entrega: se usa la confirmación simple de antes. */
  alSinPrueba: () => void;
}) {
  const [esperado, setEsperado] = useState<Esperado | null>(null);
  const [cargandoDatos, setCargandoDatos] = useState(true);
  const [recibe, setRecibe] = useState('');
  const [completo, setCompleto] = useState<boolean | null>(null);
  const [cantidad, setCantidad] = useState('');
  const [novedad, setNovedad] = useState<Novedad>('sin_novedad');
  const [nota, setNota] = useState('');
  const [fotoGuia, setFotoGuia] = useState<string | null>(null);
  const [sinGuia, setSinGuia] = useState(false);
  const [fotosNovedad, setFotosNovedad] = useState<string[]>([]);
  const [camara, setCamara] = useState<'guia' | 'novedad' | null>(null);
  const [permiso, pedirPermiso] = useCameraPermissions();
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Ruta de cada foto en el servidor, fija entre reintentos (si se cortó la respuesta, el
  // servidor ya guardó estas rutas y el reintento debe enviar las mismas).
  const rutas = useRef(new Map<string, string>());
  const rutaDe = (archivo: string, misionId: string) => {
    let r = rutas.current.get(archivo);
    if (!r) { r = rutaFoto(misionId); rutas.current.set(archivo, r); }
    return r;
  };

  // La pantalla de viaje se refresca cada 5 s y entrega funciones nuevas en cada refresco:
  // se guarda la última en una referencia para que el detalle de la carga se pida UNA sola vez
  // (antes se volvía a pedir en cada refresco y el formulario se borraba mientras el chofer escribía).
  const sinPrueba = useRef(alSinPrueba);
  sinPrueba.current = alSinPrueba;

  const cargar = useCallback(async () => {
    setCargandoDatos(true);
    setError(null);
    const { data, error: err } = await supabase.rpc('carga_para_entrega', { p_asignacion: viaje.asignacion_id });
    setCargandoDatos(false);
    if (err) {
      if (err.code === 'PGRST202') return sinPrueba.current();
      setError(mensajeSimple(err, 'No se pudo cargar el detalle de la carga. Intente de nuevo.'));
      return;
    }
    setEsperado(data as Esperado);
  }, [viaje.asignacion_id]);

  useEffect(() => { void cargar(); }, [cargar]);

  const kgUnidad = esperado?.presentacion ? KG_UNIDAD[esperado.presentacion] : undefined;
  const porUnidades = kgUnidad != null;
  const sinPesoSalida = esperado != null && esperado.kg == null;
  const numero = Number(cantidad.replace(',', '.'));
  const cantidadValida = cantidad.trim() !== '' && Number.isFinite(numero) && numero >= 0 && (!porUnidades || Number.isInteger(numero));
  const kgRecibidos = completo ? esperado?.kg ?? null : cantidadValida ? (porUnidades ? numero * kgUnidad! : numero) : null;
  const falta = esperado?.kg != null && kgRecibidos != null && kgRecibidos < esperado.kg * (1 - esperado.tolerancia_pct / 100);

  function elegirCompleto(valor: boolean) {
    setCompleto(valor);
    setError(null);
    if (!valor && novedad === 'sin_novedad') setNovedad('faltante');
    if (valor && novedad === 'faltante') setNovedad('sin_novedad');
  }

  async function abrirCamara(cual: 'guia' | 'novedad') {
    setError(null);
    if (!permiso?.granted) {
      const r = await pedirPermiso();
      if (!r.granted) {
        setError('Sin permiso de cámara no se puede tomar la foto. Actívelo en los ajustes del teléfono.');
        return;
      }
    }
    setCamara(cual);
  }

  function fotoTomada(uri: string) {
    let local: string;
    try {
      local = guardarFotoLocal(uri);
    } catch {
      setError('No se pudo guardar la foto en el teléfono. Intente de nuevo.');
      setCamara(null);
      return;
    }
    if (camara === 'guia') {
      if (fotoGuia) borrarFotoLocal(fotoGuia);
      setFotoGuia(local);
      setSinGuia(false);
    } else {
      setFotosNovedad((prev) => [...prev, local].slice(0, MAX_FOTOS_NOVEDAD));
    }
    setCamara(null);
  }

  function validar(): string | null {
    if (recibe.trim().length < 2) return 'Escriba quién recibió la carga.';
    if (completo === null && !sinPesoSalida) return 'Indique si recibieron toda la carga.';
    if ((completo === false || sinPesoSalida) && !cantidadValida) {
      return porUnidades ? 'Escriba cuántas unidades recibieron (número entero).' : 'Escriba cuántos kg recibieron.';
    }
    if (falta && novedad === 'sin_novedad') return 'Recibieron menos de lo despachado: marque la novedad «Faltante».';
    if (novedad === 'otra' && nota.trim().length < 3) return 'Describa la novedad.';
    if (!fotoGuia && !sinGuia) return 'Tome la foto de la guía firmada, o marque «No me dieron guía».';
    return null;
  }

  async function confirmar() {
    const problema = validar();
    if (problema) return setError(problema);
    if (!esperado) return;
    setEnviando(true);
    setError(null);
    try {
      // Antes de entregar se intenta enviar lo pendiente (lo que quede se envía después).
      const quedan = await enviarTodo();
      const guia = fotoGuia ? { ruta: rutaDe(fotoGuia, esperado.mision_id), archivo: fotoGuia } : null;
      const novedades = (novedad === 'sin_novedad' ? [] : fotosNovedad).map((archivo) => ({ ruta: rutaDe(archivo, esperado.mision_id), archivo }));
      const usaCompleto = completo === true && !sinPesoSalida;
      const datos: Record<string, unknown> = {
        recibido_por: recibe.trim(),
        completo: usaCompleto,
        novedad,
        nota: nota.trim() || null,
        foto_guia: guia?.ruta ?? null,
        sin_guia: !guia && sinGuia,
        fotos_novedad: novedades.map((f) => f.ruta),
      };
      if (!usaCompleto) datos[porUnidades ? 'unidades' : 'kg'] = numero;
      const { error: err } = await supabase.rpc('registrar_entrega_chofer', {
        p_asignacion: viaje.asignacion_id,
        p_datos: datos,
        p_hora_dispositivo: new Date().toISOString(),
      });
      if (err) throw err;
      // Las fotos quedan en cola: se suben ahora si hay señal, o después.
      await encolarFotos(viaje.asignacion_id, [...(guia ? [guia] : []), ...novedades]);
      fotosNovedad.filter((f) => !novedades.some((n) => n.archivo === f)).forEach(borrarFotoLocal);
      const fotos = await subirFotosPendientes();
      alRegistrada({ quedan, fotos });
    } catch (err) {
      setError(mensajeSimple(err, 'No se pudo registrar la entrega. Intente de nuevo.'));
    } finally {
      setEnviando(false);
    }
  }

  if (camara) {
    return (
      <Camara
        titulo={camara === 'guia' ? 'Foto de la guía firmada: que se lea la firma y el sello' : 'Foto de la novedad'}
        alTomar={fotoTomada}
        alCancelar={() => setCamara(null)}
      />
    );
  }

  return (
    <View style={e.pantalla}>
      <ScrollView contentContainerStyle={e.contenido} keyboardShouldPersistTaps="handled">
        <View style={e.tarjeta}>
          <Text style={e.etiqueta}>Entrega · Misión {viaje.mision_codigo}</Text>
          <Text style={e.titulo}>{viaje.destino}</Text>
        </View>

        {cargandoDatos ? (
          <ActivityIndicator size="large" color={MARCA.verde} />
        ) : !esperado ? (
          <View style={{ gap: 12 }}>
            {error && <Text style={e.error}>{error}</Text>}
            <Boton texto="Reintentar" onPress={() => void cargar()} />
            <Boton texto="Volver" variante="cafe" onPress={alVolver} />
          </View>
        ) : (
          <>
            <View style={[e.tarjeta, { gap: 10 }]}>
              <Text style={e.etiqueta}>1. ¿Quién recibió la carga?</Text>
              <TextInput style={estiloCampo} value={recibe} onChangeText={setRecibe} maxLength={120}
                placeholder="Nombre y cargo" autoCapitalize="words" editable={!enviando} />
            </View>

            <View style={[e.tarjeta, { gap: 10 }]}>
              <Text style={e.etiqueta}>2. ¿Cuánto recibieron?</Text>
              <Text style={e.texto}>Salió: <Text style={{ fontFamily: F.negrita }}>{textoCarga(esperado)}</Text></Text>
              {!sinPesoSalida && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  <Opcion texto="Todo completo" activa={completo === true} onPress={() => elegirCompleto(true)} />
                  <Opcion texto="Recibieron menos" activa={completo === false} onPress={() => elegirCompleto(false)} />
                </View>
              )}
              {(completo === false || sinPesoSalida) && (
                <TextInput style={estiloCampo} value={cantidad} onChangeText={setCantidad} keyboardType="numeric" maxLength={8}
                  placeholder={porUnidades ? `Cantidad de ${NOMBRE_UNIDAD[esperado.presentacion!]![1]}` : 'Kg recibidos'} editable={!enviando} />
              )}
              {completo === false && cantidadValida && kgRecibidos != null && esperado.kg != null && (
                <Text style={e.textoChico}>Faltan {miles(Math.max(0, esperado.kg - kgRecibidos))} kg.</Text>
              )}
            </View>

            <View style={[e.tarjeta, { gap: 10 }]}>
              <Text style={e.etiqueta}>3. ¿Hubo alguna novedad?</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {NOVEDADES.map((n) => (
                  <Opcion key={n.id} texto={n.texto} activa={novedad === n.id} onPress={() => { setNovedad(n.id); setError(null); }} />
                ))}
              </View>
              {novedad !== 'sin_novedad' && (
                <>
                  <TextInput style={[estiloCampo, { minHeight: 70, textAlignVertical: 'top' }]} value={nota} onChangeText={setNota}
                    maxLength={300} multiline placeholder={novedad === 'otra' ? 'Describa la novedad' : 'Detalle (opcional)'} editable={!enviando} />
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    {fotosNovedad.map((f) => (
                      <Pressable key={f} accessibilityLabel="Quitar foto" onPress={() => { borrarFotoLocal(f); setFotosNovedad((p) => p.filter((x) => x !== f)); }}>
                        <Image source={{ uri: f }} style={{ width: 90, height: 90, borderRadius: 8 }} />
                        <Text style={[e.textoChico, { textAlign: 'center' }]}>Quitar</Text>
                      </Pressable>
                    ))}
                  </View>
                  {fotosNovedad.length < MAX_FOTOS_NOVEDAD && (
                    <Boton texto="Foto de la novedad" variante="dorado" onPress={() => void abrirCamara('novedad')} deshabilitado={enviando} />
                  )}
                </>
              )}
            </View>

            <View style={[e.tarjeta, { gap: 10 }]}>
              <Text style={e.etiqueta}>4. Guía firmada por el cliente</Text>
              {fotoGuia ? (
                <View style={{ gap: 8 }}>
                  <Image source={{ uri: fotoGuia }} style={{ width: '100%', height: 220, borderRadius: 8 }} resizeMode="contain" />
                  <Boton texto="Tomar otra vez" variante="cafe" onPress={() => void abrirCamara('guia')} deshabilitado={enviando} />
                </View>
              ) : (
                <Boton texto="Tomar foto de la guía" variante="dorado" onPress={() => void abrirCamara('guia')} deshabilitado={enviando} />
              )}
              {!fotoGuia && (
                <Opcion texto="No me dieron guía" activa={sinGuia} onPress={() => { setSinGuia((v) => !v); setError(null); }} />
              )}
            </View>

            {error && <Text style={e.error}>{error}</Text>}
            <Boton texto="Confirmar entrega" onPress={() => void confirmar()} cargando={enviando} />
            <Boton texto="Volver" variante="cafe" onPress={alVolver} deshabilitado={enviando} />
            <Text style={e.textoChico}>
              Al confirmar se cierra el viaje y se detiene el rastreo. Si no hay señal para las fotos, se envían solas después.
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}
