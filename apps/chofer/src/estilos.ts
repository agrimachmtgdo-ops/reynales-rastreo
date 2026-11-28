import { StyleSheet } from 'react-native';
import { MARCA } from '@reynales/shared';

export const F = {
  normal: 'Montserrat_400Regular',
  semi: 'Montserrat_600SemiBold',
  negrita: 'Montserrat_700Bold',
};

export const e = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: MARCA.crema },
  contenido: { padding: 20, gap: 14 },
  logo: { width: '100%', height: 70, resizeMode: 'contain', marginBottom: 8 },
  titulo: { fontFamily: F.negrita, fontSize: 22, color: MARCA.cafe },
  texto: { fontFamily: F.normal, fontSize: 16, color: '#2B1D10', lineHeight: 23 },
  textoChico: { fontFamily: F.normal, fontSize: 13, color: MARCA.gris },
  etiqueta: { fontFamily: F.semi, fontSize: 13, color: MARCA.cafe },
  tarjeta: { backgroundColor: MARCA.blanco, borderRadius: 12, padding: 16, gap: 6, borderWidth: 1, borderColor: '#E6DCCB' },
  entrada: {
    backgroundColor: MARCA.blanco, borderWidth: 2, borderColor: MARCA.dorado, borderRadius: 10,
    paddingVertical: 14, paddingHorizontal: 16, fontFamily: F.negrita, fontSize: 26, letterSpacing: 6,
    textAlign: 'center', color: MARCA.cafe,
  },
  boton: { backgroundColor: MARCA.verdeOscuro, borderRadius: 12, paddingVertical: 18, alignItems: 'center' },
  botonDorado: { backgroundColor: MARCA.dorado },
  botonCafe: { backgroundColor: MARCA.cafe },
  botonDeshabilitado: { opacity: 0.5 },
  textoBoton: { fontFamily: F.negrita, fontSize: 18, color: MARCA.blanco },
  error: { fontFamily: F.semi, fontSize: 15, color: MARCA.rojo },
});
