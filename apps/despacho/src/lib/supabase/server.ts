import 'server-only';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

/** Cliente de Supabase para componentes de servidor y acciones (usa la sesión del usuario: aplica RLS). */
export async function crearClienteServidor() {
  const almacen = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => almacen.getAll(),
        setAll: (lista) => {
          try {
            lista.forEach(({ name, value, options }) => almacen.set(name, value, options));
          } catch {
            // En componentes de servidor no se pueden escribir cookies; el proxy las renueva.
          }
        },
      },
    },
  );
}
