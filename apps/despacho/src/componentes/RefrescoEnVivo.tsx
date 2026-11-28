'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { crearClienteNavegador } from '@/lib/supabase/client';

/**
 * Mantiene al día una página de servidor (detalle de misión):
 * se refresca cuando cambia algún camión de la misión (tiempo real),
 * cada 60 s como respaldo y al volver a la pestaña.
 * Los campos que el usuario esté escribiendo no se pierden.
 */
export default function RefrescoEnVivo({ misionId }: { misionId: string }) {
  const router = useRouter();
  const [actualizado, setActualizado] = useState<Date | null>(null);
  const ultimo = useRef(0);
  const pendiente = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Como máximo un refresco cada 10 s, aunque lleguen muchas posiciones seguidas.
    const refrescar = () => {
      if (document.visibilityState !== 'visible') return;
      const espera = Math.max(0, ultimo.current + 10_000 - Date.now());
      if (pendiente.current) return;
      pendiente.current = setTimeout(() => {
        pendiente.current = null;
        ultimo.current = Date.now();
        router.refresh();
        setActualizado(new Date());
      }, espera);
    };

    const supabase = crearClienteNavegador();
    const canal = supabase
      .channel(`mision-${misionId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'asignaciones', filter: `mision_id=eq.${misionId}` }, refrescar)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'misiones', filter: `id=eq.${misionId}` }, refrescar)
      .subscribe();
    const intervalo = setInterval(refrescar, 60_000);
    const alVolver = () => document.visibilityState === 'visible' && refrescar();
    document.addEventListener('visibilitychange', alVolver);

    return () => {
      void supabase.removeChannel(canal);
      clearInterval(intervalo);
      document.removeEventListener('visibilitychange', alVolver);
      if (pendiente.current) clearTimeout(pendiente.current);
    };
  }, [misionId, router]);

  return (
    <span className="refresco-en-vivo" aria-live="polite">
      <span className="punto-vivo" aria-hidden /> En vivo
      {actualizado && ` · actualizado ${actualizado.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/La_Paz' })}`}
    </span>
  );
}
