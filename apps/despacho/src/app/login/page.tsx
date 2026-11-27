'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { crearClienteNavegador } from '@/lib/supabase/client';

export default function PaginaLogin() {
  const router = useRouter();
  const [correo, setCorreo] = useState('');
  const [clave, setClave] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function ingresar(e: React.FormEvent) {
    e.preventDefault();
    setCargando(true);
    setError(null);
    const { error } = await crearClienteNavegador().auth.signInWithPassword({ email: correo, password: clave });
    setCargando(false);
    if (error) {
      // Mensajes distintos para que el personal sepa a quién pedir ayuda.
      if (error.code === 'email_not_confirmed') {
        setError('Su correo aún no está confirmado. Pida al administrador que lo confirme.');
      } else if (error.status === 429) {
        setError('Demasiados intentos. Espere unos minutos y vuelva a intentar.');
      } else if (error.code === 'invalid_credentials') {
        setError('Correo o contraseña incorrectos.');
      } else {
        setError('No se pudo ingresar. Revise su conexión e intente de nuevo.');
      }
      return;
    }
    router.replace('/');
    router.refresh();
  }

  return (
    <main style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 16 }}>
      <form onSubmit={ingresar} className="tarjeta" style={{ width: 360, borderTop: '6px solid var(--dorado)' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="Industrias Reynales" style={{ width: '100%', marginBottom: 16 }} />
        <h1>Panel de despacho</h1>
        {error && <div className="mensaje-error">{error}</div>}
        <label>
          Correo
          <input type="email" required value={correo} onChange={(e) => setCorreo(e.target.value)} autoComplete="email" />
        </label>
        <label>
          Contraseña
          <input type="password" required value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="current-password" />
        </label>
        <button className="boton" disabled={cargando} style={{ width: '100%' }}>
          {cargando ? 'Ingresando…' : 'Ingresar'}
        </button>
      </form>
    </main>
  );
}
