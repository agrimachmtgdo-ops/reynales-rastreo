'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ENLACES = [
  { href: '/', texto: 'Tablero' },
  { href: '/pedidos', texto: 'Pedidos' },
  { href: '/programa', texto: 'Programa' },
  { href: '/misiones', texto: 'Misiones' },
  { href: '/almacen', texto: 'Almacén' },
  { href: '/lotes', texto: 'Lotes' },
  { href: '/reportes', texto: 'Reportes' },
  { href: '/cumplimiento', texto: 'Cumplimiento' },
  { href: '/catalogos', texto: 'Catálogos' },
];

/** Menú principal: marca la sección en la que está el usuario. */
export default function Navegacion({ esAdmin = false }: { esAdmin?: boolean }) {
  const ruta = usePathname();
  const enlaces = esAdmin ? [...ENLACES, { href: '/usuarios', texto: 'Usuarios' }] : ENLACES;
  return (
    <nav aria-label="Menú principal">
      {enlaces.map((e) => {
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
