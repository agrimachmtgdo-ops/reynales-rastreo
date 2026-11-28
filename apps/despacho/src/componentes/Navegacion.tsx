'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ENLACES = [
  { href: '/', texto: 'Tablero' },
  { href: '/misiones', texto: 'Misiones' },
  { href: '/reportes', texto: 'Reportes' },
  { href: '/catalogos', texto: 'Catálogos' },
];

/** Menú principal: marca la sección en la que está el usuario. */
export default function Navegacion() {
  const ruta = usePathname();
  return (
    <nav aria-label="Menú principal">
      {ENLACES.map((e) => {
        const activo = e.href === '/' ? ruta === '/' : ruta.startsWith(e.href);
        return (
          <Link key={e.href} href={e.href} className={activo ? 'activo' : undefined} aria-current={activo ? 'page' : undefined}>
            {e.texto}
          </Link>
        );
      })}
    </nav>
  );
}
