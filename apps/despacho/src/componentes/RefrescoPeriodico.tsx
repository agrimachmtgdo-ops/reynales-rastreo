'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Vuelve a pedir la página cada cierto tiempo y al regresar a la pestaña (página pública de seguimiento). */
export default function RefrescoPeriodico({ segundos }: { segundos: number }) {
  const router = useRouter();
  useEffect(() => {
    const refrescar = () => {
      if (document.visibilityState === 'visible') router.refresh();
    };
    const id = setInterval(refrescar, segundos * 1000);
    document.addEventListener('visibilitychange', refrescar);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', refrescar);
    };
  }, [router, segundos]);
  return null;
}
