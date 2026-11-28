import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { crearClienteServidor } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Transbordo · Industrias Reynales' };

/** Sección para la empresa del transbordo (celular): solo cuentas de operador. */
export default async function LayoutTransbordo({ children }: { children: React.ReactNode }) {
  const supabase = await crearClienteServidor();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect('/login');
  const { data: operador } = await supabase.rpc('mi_operador');
  const op = operador as { nombre: string; empresa: string } | null;
  if (!op) {
    // El personal de la fábrica usa el panel.
    const { data: perfil } = await supabase.from('usuarios').select('activo').eq('id', data.claims.sub).maybeSingle();
    if (perfil?.activo) redirect('/');
  }
  return (
    <>
      <header className="encabezado encabezado-transbordo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="Industrias Reynales" />
        <span className="usuario">{op ? `${op.nombre} · ${op.empresa}` : 'Sin acceso'}</span>
        <form action="/auth/salir" method="post">
          <button className="boton secundario">Salir</button>
        </form>
      </header>
      <main className="contenido contenido-transbordo">
        {op ? children : (
          <div className="tarjeta">
            <h1>Cuenta no habilitada</h1>
            <p>Su cuenta existe, pero Industrias Reynales aún no la habilitó para el transbordo (o fue desactivada). Comuníquese con despacho.</p>
          </div>
        )}
      </main>
    </>
  );
}
