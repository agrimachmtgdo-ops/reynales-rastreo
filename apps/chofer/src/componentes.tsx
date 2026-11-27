import { ActivityIndicator, Pressable, Text, type ViewStyle } from 'react-native';
import { MARCA } from '@reynales/shared';
import { e } from './estilos';

export function Boton({
  texto,
  onPress,
  variante = 'verde',
  deshabilitado = false,
  cargando = false,
}: {
  texto: string;
  onPress: () => void;
  variante?: 'verde' | 'dorado' | 'cafe';
  deshabilitado?: boolean;
  cargando?: boolean;
}) {
  const extra: ViewStyle[] = [];
  if (variante === 'dorado') extra.push(e.botonDorado);
  if (variante === 'cafe') extra.push(e.botonCafe);
  if (deshabilitado || cargando) extra.push(e.botonDeshabilitado);
  return (
    <Pressable style={[e.boton, ...extra]} onPress={onPress} disabled={deshabilitado || cargando} accessibilityRole="button">
      {cargando ? (
        <ActivityIndicator color={MARCA.blanco} />
      ) : (
        <Text style={[e.textoBoton, variante === 'dorado' && { color: MARCA.cafe }]}>{texto}</Text>
      )}
    </Pressable>
  );
}
