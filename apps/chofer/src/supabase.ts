import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import Storage from 'expo-sqlite/kv-store';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const clave = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !clave) {
  console.warn('Faltan EXPO_PUBLIC_SUPABASE_URL y EXPO_PUBLIC_SUPABASE_ANON_KEY en apps/chofer/.env');
}

export const supabase = createClient(url ?? 'http://localhost', clave ?? 'sin-clave', {
  auth: {
    storage: Storage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

/** Garantiza una sesión anónima (el chofer no usa correo ni contraseña). */
export async function asegurarSesion() {
  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session;
  const { data: nueva, error } = await supabase.auth.signInAnonymously();
  if (error) throw new Error('No se pudo conectar. Revise su señal e intente de nuevo.');
  return nueva.session;
}
