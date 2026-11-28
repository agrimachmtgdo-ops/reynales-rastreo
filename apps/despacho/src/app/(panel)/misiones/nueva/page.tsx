import Link from 'next/link';
import { crearClienteServidor } from '@/lib/supabase/server';
import { cargarCatalogosCamion } from '@/lib/catalogos';
import CamposCamion from '@/componentes/CamposCamion';
import SeccionTransbordo from '@/componentes/SeccionTransbordo';
import FormularioAccion from '@/componentes/FormularioAccion';
import { NotaObligatorio, Req } from '@/componentes/Obligatorio';
import { crearMision } from '../acciones';

export const dynamic = 'force-dynamic';

export default async function PaginaNuevaMision() {
  const supabase = await crearClienteServidor();
  const [clientes, ubicaciones, catalogos] = await Promise.all([
    supabase.from('clientes').select('id, razon_social').order('razon_social'),
    supabase.from('ubicaciones').select('id, nombre, ciudad, pais, tipo').eq('activo', true).order('nombre'),
    cargarCatalogosCamion(),
  ]);
  const origenes = (ubicaciones.data ?? []).filter((u) => u.tipo === 'fabrica');
  const destinos = (ubicaciones.data ?? []).filter((u) => u.tipo === 'destino');

  return (
    <section className="tarjeta">
      <h1>Nueva misión</h1>
      {((clientes.data ?? []).length === 0 || origenes.length === 0 || destinos.length === 0) && (
        <p className="alerta">
          Faltan datos en <Link href="/catalogos?pestana=clientes">Catálogos</Link>:{' '}
          {[(clientes.data ?? []).length === 0 && 'clientes', origenes.length === 0 && 'una fábrica (origen)', destinos.length === 0 && 'un destino']
            .filter(Boolean).join(', ')}.
        </p>
      )}
      <FormularioAccion accion={crearMision} boton="Crear misión">
        <NotaObligatorio />
        <h2>Envío</h2>
        <div className="rejilla">
          <label>
            Cliente <Req />
            <select name="cliente_id" required defaultValue="">
              <option value="" disabled>Seleccione…</option>
              {(clientes.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.razon_social}</option>)}
            </select>
          </label>
          <label>
            Origen <Req />
            <select name="origen_id" required defaultValue="">
              <option value="" disabled>Seleccione…</option>
              {origenes.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
            </select>
          </label>
          <label>
            Destino <Req />
            <select name="destino_id" required defaultValue="">
              <option value="" disabled>Seleccione…</option>
              {destinos.map((u) => <option key={u.id} value={u.id}>{u.nombre} ({u.pais})</option>)}
            </select>
          </label>
          <label>N.º de factura<input name="factura" /></label>
          <label>N.º de guía<input name="guia" /></label>
          <label>N.º de DEX<input name="dex" /></label>
          <label>Tipo de carga<input name="tipo_carga" /></label>
          <label>Tonelaje objetivo (TN)<input name="tonelaje_objetivo" inputMode="decimal" /></label>
          <label>WhatsApp del coordinador<input name="telefono_coordinador" placeholder="+591…" /></label>
        </div>
        <label>Notas<textarea name="notas" rows={2} /></label>
        <h2>Transbordo</h2>
        <SeccionTransbordo transportistas={catalogos.transportistas} />
        <h2>Primer camión</h2>
        <CamposCamion catalogos={catalogos} />
      </FormularioAccion>
    </section>
  );
}
