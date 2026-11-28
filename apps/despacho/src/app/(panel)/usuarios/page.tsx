import Link from 'next/link';
import { crearClienteServidor } from '@/lib/supabase/server';
import FormularioCatalogo from '@/componentes/FormularioCatalogo';
import { Req } from '@/componentes/Obligatorio';
import { formatoHora } from '@/lib/tipos';
import { nombrePerfil, PERFILES } from '@/lib/perfiles';
import { guardarPersonal, registrarPersonal } from './acciones';

export const dynamic = 'force-dynamic';

interface Persona {
  id: string; nombre: string; correo: string | null; perfil: string; activo: boolean;
  creado_en: string; ultimo_ingreso: string | null; clientes_asignados: number;
}

const opcionesPerfil = PERFILES.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>);

/** Usuarios del panel y su perfil. Solo el administrador entra aquí. */
export default async function PaginaUsuarios({ searchParams }: { searchParams: Promise<{ editar?: string }> }) {
  const sp = await searchParams;
  const supabase = await crearClienteServidor();
  const { data: perfil } = await supabase.rpc('perfil_actual');
  if (perfil !== 'administrador') {
    return <div className="tarjeta"><h1>Usuarios</h1><p>Solo un administrador puede ver y cambiar los usuarios.</p></div>;
  }
  const { data, error } = await supabase.rpc('listar_personal');
  const personas = (data ?? []) as Persona[];
  const editando = sp.editar ? personas.find((p) => p.id === sp.editar) : undefined;

  return (
    <>
      <h1>Usuarios</h1>
      <section className="tarjeta">
        <h2>Perfiles</h2>
        <dl className="perfiles">
          {PERFILES.map((p) => <div key={p.id}><dt>{p.nombre}</dt><dd>{p.descripcion}</dd></div>)}
        </dl>
        <p className="ayuda">Los operadores de transbordo se habilitan en Catálogos → Transportistas.</p>
      </section>

      {editando && (
        <section className="tarjeta" id="editar">
          <h2>Editar a {editando.nombre}</h2>
          <FormularioCatalogo accion={guardarPersonal.bind(null, editando.id)} boton="Guardar cambios" cancelar="/usuarios">
            <label>Nombre <Req /><input name="nombre" required defaultValue={editando.nombre} /></label>
            <label>Perfil <Req /><select name="perfil" required defaultValue={editando.perfil}>{opcionesPerfil}</select></label>
            <label className="casilla"><input type="checkbox" name="activo" defaultChecked={editando.activo} /> Activo (puede entrar al panel)</label>
          </FormularioCatalogo>
          {editando.clientes_asignados > 0 && (
            <p className="ayuda">Tiene {editando.clientes_asignados} cliente(s) asignado(s). Si deja de ser comercial o se desactiva, esos clientes quedan sin comercial.</p>
          )}
        </section>
      )}

      <section className="tarjeta">
        <h2>Personal de la fábrica</h2>
        <details className="agregar">
          <summary>+ Agregar usuario</summary>
          <ol className="ayuda">
            <li>En Supabase, Authentication → Users → Add user: escriba su correo y una contraseña, y marque «Auto Confirm User».</li>
            <li>Complete aquí el mismo correo, su nombre y su perfil.</li>
            <li>Envíele el enlace del panel, su correo y su contraseña.</li>
          </ol>
          <FormularioCatalogo accion={registrarPersonal} boton="Agregar usuario">
            <label>Correo de la cuenta <Req /><input name="correo" type="email" required autoComplete="off" /></label>
            <label>Nombre <Req /><input name="nombre" required /></label>
            <label>Perfil <Req />
              <select name="perfil" required defaultValue="">
                <option value="" disabled>Seleccione…</option>
                {opcionesPerfil}
              </select>
            </label>
          </FormularioCatalogo>
        </details>
        {error && <div className="mensaje-error">No se pudo cargar la lista: {error.message}</div>}
        <div className="tabla-desplazable"><table>
          <thead><tr><th>Nombre</th><th>Correo</th><th>Perfil</th><th>Estado</th><th>Último ingreso</th><th>Clientes</th><th></th></tr></thead>
          <tbody>{personas.map((p) => (
            <tr key={p.id} className={p.activo ? undefined : 'inactivo'}>
              <td>{p.nombre}</td>
              <td>{p.correo}</td>
              <td>{p.activo ? nombrePerfil(p.perfil) : '—'}</td>
              <td>{p.activo ? 'Activo' : 'Pendiente o inactivo'}</td>
              <td>{p.ultimo_ingreso ? formatoHora(p.ultimo_ingreso) : 'Nunca'}</td>
              <td>{p.clientes_asignados > 0 ? p.clientes_asignados : ''}</td>
              <td className="acciones"><Link href={`/usuarios?editar=${p.id}#editar`}>Editar</Link></td>
            </tr>
          ))}</tbody>
        </table></div>
        <p className="ayuda">Una cuenta que alguien creó por su cuenta aparece como «Pendiente o inactivo» hasta que usted le dé un perfil y la active.</p>
      </section>
    </>
  );
}
