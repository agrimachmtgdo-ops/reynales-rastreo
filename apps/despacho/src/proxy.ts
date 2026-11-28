import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

/**
 * Se ejecuta antes de cada página: renueva la sesión y envía a /login a quien no la tenga
 * (salvo la página pública de seguimiento para clientes).
 */
export async function proxy(request: NextRequest) {
  // La página de seguimiento para clientes es pública: no usa sesión ni cookies.
  if (request.nextUrl.pathname.startsWith('/seguimiento/')) {
    const publica = NextResponse.next();
    publica.headers.set('X-Robots-Tag', 'noindex, nofollow');
    publica.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    return publica;
  }

  let respuesta = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (lista) => {
          lista.forEach(({ name, value }) => request.cookies.set(name, value));
          respuesta = NextResponse.next({ request });
          lista.forEach(({ name, value, options }) => respuesta.cookies.set(name, value, options));
        },
      },
    },
  );

  // getClaims verifica la firma del token en el propio servidor (sin ir a Supabase en cada clic);
  // solo consulta a Supabase cuando hay que renovar la sesión.
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims ?? null;

  const enLogin = request.nextUrl.pathname.startsWith('/login');
  if (!user && !enLogin) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }
  if (user && enLogin) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }
  return respuesta;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|logo.png|.*\\.(?:svg|png|jpg|css)$).*)'],
};
