import { crearClienteServidor } from '@/lib/supabase/server';
import FormularioCatalogo from './FormularioCatalogo';
import { Req } from './Obligatorio';
import { alternarOperador, registrarOperador } from '@/app/(panel)/catalogos/acciones';

interface Operador {
  id: string; nombre: string; correo: string | null; telefono: string | null; activo: boolean;
  transportista: { razon_social: string } | null;
}

/** Cuentas de las empresas de transbordo (Catálogos → Transportistas). Solo el administrador las crea. */
export default async function SeccionOperadores({ transportistas }: { transportistas: { id: string; razon_social: string }[] }) {
  const supabase = await crearClienteServidor();
  const { data: claims } = await supabase.auth.getClaims();
  const [{ data: perfil }, { data, error }] = await Promise.all([
    supabase.from('usuarios').select('rol').eq('id', claims?.claims?.sub ?? '').maybeSingle(),
    supabase.from('operadores_transbordo').select('id, nombre, correo, telefono, activo, transportista:transportistas(razon_social)')
      .order('activo', { ascending: false }).order('nombre'),
  ]);
  const esAdmin = perfil?.rol === 'administrador';
  const operadores = (data ?? []) as unknown as Operador[];
  return (
    <section className="tarjeta">
      <h2>Operadores de transbordo</h2>
      <p className="ayuda">
        Personas de la empresa del transbordo (El Alto) que registran sus camiones, confirman que recibieron la carga y suben el CRT y el MIC/DTA
        desde el celular. Solo ven las cargas donde su empresa hace un tramo.
      </p>
      {error && <div className="mensaje-error">No se pudo cargar la lista: {error.message}</div>}
      {esAdmin ? (
        <details className="agregar">
          <summary>+ Habilitar operador</summary>
          <ol className="ayuda">
            <li>En Supabase, Authentication → Users → Add user: escriba su correo y una contraseña y marque «Auto Confirm User».</li>
            <li>Complete aquí el mismo correo, su nombre y la empresa.</li>
            <li>Envíele el enlace del panel, su correo y su contraseña. Al entrar verá solo «Mis cargas».</li>
          </ol>
          <FormularioCatalogo accion={registrarOperador} boton="Habilitar operador">
            <label>Correo de la cuenta <Req /><input name="correo" type="email" required autoComplete="off" /></label>
            <label>Nombre <Req /><input name="nombre" required /></label>
            <label>Empresa <Req />
              <select name="transportista_id" required defaultValue="">
                <option value="" disabled>Seleccione…</option>
                {transportistas.map((t) => <option key={t.id} value={t.id}>{t.razon_social}</option>)}
              </select>
            </label>
            <label>WhatsApp<input name="telefono" inputMode="tel" placeholder="+59171234567" /></label>
          </FormularioCatalogo>
        </details>
      ) : (
        <p className="ayuda">Solo un administrador puede habilitar o desactivar operadores.</p>
      )}
      {operadores.length === 0 ? <p>Todavía no hay operadores.</p> : (
        <div className="tabla-desplazable"><table>
          <thead><tr><th>Operador</th><th>Empresa</th><th>Correo</th><th>Teléfono</th><th>Estado</th>{esAdmin && <th></th>}</tr></thead>
          <tbody>{operadores.map((o) => (
            <tr key={o.id} className={o.activo ? undefined : 'inactivo'}>
              <td>{o.nombre}</td><td>{o.transportista?.razon_social}</td><td>{o.correo}</td><td>{o.telefono}</td>
              <td>{o.activo ? 'Activo' : 'Inactivo'}</td>
              {esAdmin && (
                <td className="acciones">
                  <form action={alternarOperador.bind(null, o.id, !o.activo)} style={{ display: 'inline' }}>
                    <button className="enlace-boton">{o.activo ? 'Desactivar' : 'Activar'}</button>
                  </form>
                </td>
              )}
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
  );
}
