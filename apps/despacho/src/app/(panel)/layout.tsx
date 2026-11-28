import Navegacion from '@/componentes/Navegacion';
import { redirect } from 'next/navigation';
import { crearClienteServidor } from '@/lib/supabase/server';
import { nombrePerfil } from '@/lib/perfiles';

/** Iniciales para el círculo del usuario (máximo dos letras). */
function iniciales(nombre: string) {
  const partes = nombre.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean);
  return ((partes[0]?.[0] ?? '') + (partes[1]?.[0] ?? '')).toUpperCase() || '?';
}

export default async function LayoutPanel({ children }: { children: React.ReactNode }) {
  const supabase = await crearClienteServidor();
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims;
  if (!user) redirect('/login');

  const [{ data: perfil }, { data: perfilActual }] = await Promise.all([
    supabase.from('usuarios').select('nombre, activo').eq('id', user.sub).maybeSingle(),
    supabase.rpc('perfil_actual'),
  ]);
  // El operador de transbordo (El Alto) tiene su propia sección para celular.
  if (!perfil?.activo) {
    const { data: operador } = await supabase.rpc('mi_operador');
    if (operador) redirect('/transbordo');
  }

  return (
    <>
      <header className="encabezado">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="Industrias Reynales" />
        <Navegacion esAdmin={perfilActual === 'administrador'} />
        <div className="usuario">
          <span className="avatar" aria-hidden="true">{iniciales(perfil?.nombre ?? user.email ?? '')}</span>
          <span className="usuario-texto">
            <span className="usuario-nombre">{perfil?.nombre ?? user.email}</span>
            <span className="usuario-perfil">{nombrePerfil(perfilActual as string | null)}</span>
          </span>
          <form action="/auth/salir" method="post">
            <button className="boton-salir">Salir</button>
          </form>
        </div>
      </header>
      <main className="contenido">
        {perfil?.activo ? (
          children
        ) : (
          <div className="tarjeta">
            <h1>Cuenta pendiente de activación</h1>
            <p>
              Su cuenta existe, pero un administrador debe asignarle un perfil (administrador, logística, comercial o gerencia) antes de
              ver la información de los camiones.
            </p>
          </div>
        )}
      </main>
    </>
  );
}
