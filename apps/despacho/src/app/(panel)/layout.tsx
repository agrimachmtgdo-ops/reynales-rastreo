import Link from 'next/link';
import { redirect } from 'next/navigation';
import { crearClienteServidor } from '@/lib/supabase/server';

export default async function LayoutPanel({ children }: { children: React.ReactNode }) {
  const supabase = await crearClienteServidor();
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims;
  if (!user) redirect('/login');

  const { data: perfil } = await supabase.from('usuarios').select('nombre, rol, activo').eq('id', user.sub).maybeSingle();

  return (
    <>
      <header className="encabezado">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="Industrias Reynales" />
        <nav>
          <Link href="/">Tablero</Link>
          <Link href="/misiones">Misiones</Link>
          <Link href="/catalogos">Catálogos</Link>
        </nav>
        <span className="usuario">
          {perfil?.nombre ?? user.email} · {perfil?.rol ?? 'sin rol'}
        </span>
        <form action="/auth/salir" method="post">
          <button className="boton secundario">Salir</button>
        </form>
      </header>
      <main className="contenido">
        {perfil?.activo ? (
          children
        ) : (
          <div className="tarjeta">
            <h1>Cuenta pendiente de activación</h1>
            <p>
              Su cuenta existe, pero un administrador debe asignarle un rol (despacho, gerencia o administrador) antes de
              ver la información de los camiones.
            </p>
          </div>
        )}
      </main>
    </>
  );
}
