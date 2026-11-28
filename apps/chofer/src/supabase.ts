import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import Storage from 'expo-sqlite/kv-store';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const clave = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !clave) {
  console.warn('Faltan EXPO_PUBLIC_SUPABASE_URL y EXPO_PUBLIC_SUPABASE_ANON_KEY en apps/chofer/.env');
}

/** Ninguna petición espera más de 20 s: con señal inestable, un envío colgado bloqueaba los demás. */
const LIMITE_MS = 20_000;
const fetchConLimite: typeof fetch = (entrada, opciones) => {
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), LIMITE_MS);
  opciones?.signal?.addEventListener('abort', () => control.abort());
  return fetch(entrada, { ...opciones, signal: control.signal }).finally(() => clearTimeout(reloj));
};

export const supabase = createClient(url ?? 'http://localhost', clave ?? 'sin-clave', {
  global: { fetch: fetchConLimite },
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
  if (error) {
    // Si el servidor respondió, el problema no es la señal: avisar a despacho.
    if (error.status && error.status < 500) {
      throw new Error('El sistema no está aceptando choferes en este momento. Avise a despacho.');
    }
    throw new Error('No se pudo conectar. Revise su señal e intente de nuevo.');
  }
  return nueva.session;
}
