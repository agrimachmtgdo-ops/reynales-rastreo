import Link from 'next/link';
import { crearClienteServidor } from '@/lib/supabase/server';
import FormularioCatalogo from '@/componentes/FormularioCatalogo';
import SelectorUbicacion from '@/componentes/SelectorUbicacion';
import SeccionOperadores from '@/componentes/SeccionOperadores';
import {
  actualizarRegistro,
  alternarActivo,
  crearCliente,
  crearConductor,
  crearProducto,
  crearTransportista,
  crearUbicacion,
  crearVehiculo,
} from './acciones';

export const dynamic = 'force-dynamic';

type Pestana = 'clientes' | 'transportistas' | 'conductores' | 'vehiculos' | 'ubicaciones' | 'productos';
const PESTANAS: { id: Pestana; titulo: string }[] = [
  { id: 'clientes', titulo: 'Clientes' },
  { id: 'transportistas', titulo: 'Transportistas' },
  { id: 'conductores', titulo: 'Choferes' },
  { id: 'vehiculos', titulo: 'Vehículos' },
  { id: 'ubicaciones', titulo: 'Ubicaciones' },
  { id: 'productos', titulo: 'Productos' },
];
const TIPO_UBICACION: Record<string, string> = {
  fabrica: 'Fábrica',
  frontera: 'Frontera',
  destino: 'Destino',
  punto_ruta: 'Punto de ruta',
};

type Fila = Record<string, unknown> & { id: string };
const v = (f: Fila | undefined, k: string) => (f?.[k] == null ? undefined : String(f[k]));
const nombreTransportista = (f: Fila) => (f.transportista as { razon_social: string } | null)?.razon_social ?? '';
const Req = () => <span className="obligatorio" aria-hidden="true">*</span>;

export default async function PaginaCatalogos({
  searchParams,
}: {
  searchParams: Promise<{ pestana?: string; editar?: string; guardado?: string }>;
}) {
  const sp = await searchParams;
  const pestana: Pestana = PESTANAS.some((p) => p.id === sp.pestana) ? (sp.pestana as Pestana) : 'clientes';
  const supabase = await crearClienteServidor();

  // Los transportistas se necesitan siempre (listas de choferes y vehículos).
  const consultas = {
    clientes: () => supabase.from('clientes').select('*').order('razon_social'),
    transportistas: () => supabase.from('transportistas').select('*').order('razon_social'),
    conductores: () => supabase.from('conductores').select('*, transportista:transportistas(razon_social)').order('activo', { ascending: false }).order('nombre'),
    vehiculos: () => supabase.from('vehiculos').select('*, transportista:transportistas(razon_social)').order('placa'),
    ubicaciones: () => supabase.from('ubicaciones').select('*').order('activo', { ascending: false }).order('tipo').order('nombre'),
    productos: () => supabase.from('productos').select('*').order('activo', { ascending: false }).order('nombre'),
  };
  const [{ data: filasData, error }, { data: transportistasData }, { data: porCorregirData }, { data: perfilActual }, { data: comercialesData }] = await Promise.all([
    consultas[pestana](),
    supabase.from('transportistas').select('id, razon_social').order('razon_social'),
    supabase.rpc('telefonos_por_corregir'),
    supabase.rpc('perfil_actual'),
    supabase.rpc('comerciales'),
  ]);
  const esAdmin = perfilActual === 'administrador';
  const comerciales = (comercialesData ?? []) as { id: string; nombre: string }[];
  const nombreComercial = (id: unknown) => comerciales.find((c) => c.id === id)?.nombre ?? '';
  // Teléfonos antiguos sin código de país que no se pudieron corregir solos.
  const porCorregir = ((porCorregirData ?? []) as { tabla: string; fila_id: string; nombre: string; valor: string }[]);
  const NOMBRE_TABLA: Record<string, string> = { clientes: 'Cliente', conductores: 'Chofer', transportistas: 'Transportista', misiones: 'Misión' };
  const enlaceCorregir = (t: { tabla: string; fila_id: string }) =>
    t.tabla === 'misiones' ? `/misiones/${t.fila_id}` : `/catalogos?pestana=${t.tabla}&editar=${t.fila_id}`;
  const filas = (filasData ?? []) as Fila[];
  const editando = sp.editar ? filas.find((f) => f.id === sp.editar) : undefined;
  const opcionesTransportista = (transportistasData ?? []).map((t) => (
    <option key={t.id} value={t.id}>{t.razon_social}</option>
  ));
  const url = (extra = '') => `/catalogos?pestana=${pestana}${extra}`;
  const enlaceEditar = (f: Fila) => <Link href={url(`&editar=${f.id}`)} scroll>Editar</Link>;
  const botonActivo = (tabla: 'conductores' | 'ubicaciones' | 'productos', f: Fila) => (
    <form action={alternarActivo.bind(null, tabla, f.id, !f.activo)} style={{ display: 'inline' }}>
      <button className="enlace-boton">{f.activo ? 'Desactivar' : 'Activar'}</button>
    </form>
  );
  const claseFila = (f: Fila) => (f.activo === false ? 'inactivo' : undefined);

  // ---- Campos de cada formulario (sirven para agregar y para editar) ----
  const campos: Record<Pestana, (f?: Fila) => React.ReactNode> = {
    clientes: (f) => (
      <>
        <label>Razón social <Req /><input name="razon_social" required defaultValue={v(f, 'razon_social')} /></label>
        <label>NIT / RUC<input name="nit_ruc" defaultValue={v(f, 'nit_ruc')} /></label>
        <label>País<select name="pais" defaultValue={v(f, 'pais') ?? 'BO'}><option value="BO">Bolivia</option><option value="PE">Perú</option><option value="CL">Chile</option></select></label>
        <label>Contacto<input name="contacto" defaultValue={v(f, 'contacto')} /></label>
        <label>WhatsApp<input name="whatsapp" inputMode="tel" placeholder="+51987654321" defaultValue={v(f, 'whatsapp')} /></label>
        <label>Correo<input name="correo" type="email" defaultValue={v(f, 'correo')} /></label>
        {esAdmin && (
          <label>Comercial responsable
            <select name="comercial_id" defaultValue={v(f, 'comercial_id') ?? ''}>
              <option value="">Sin asignar</option>
              {comerciales.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </label>
        )}
      </>
    ),
    transportistas: (f) => (
      <>
        <label>Razón social o nombre del dueño <Req /><input name="razon_social" required defaultValue={v(f, 'razon_social')} /></label>
        <label>NIT<input name="nit" defaultValue={v(f, 'nit')} /></label>
        <label>Contacto<input name="contacto" defaultValue={v(f, 'contacto')} /></label>
        <label>Teléfono<input name="telefono" inputMode="tel" placeholder="+59171234567" defaultValue={v(f, 'telefono')} /></label>
        <label>Aceptó condiciones de rastreo el<input name="clausula_rastreo_aceptada_en" type="date" defaultValue={v(f, 'clausula_rastreo_aceptada_en')} /></label>
      </>
    ),
    conductores: (f) => (
      <>
        <label>Transportista <Req /><select name="transportista_id" required defaultValue={v(f, 'transportista_id')}>{opcionesTransportista}</select></label>
        <label>Nombre completo <Req /><input name="nombre" required defaultValue={v(f, 'nombre')} /></label>
        <label>CI (uso interno)<input name="ci" defaultValue={v(f, 'ci')} /></label>
        <label>WhatsApp del chofer<input name="telefono" inputMode="tel" placeholder="+59171234567" defaultValue={v(f, 'telefono')} /></label>
        <label>Licencia<input name="licencia" defaultValue={v(f, 'licencia')} /></label>
      </>
    ),
    vehiculos: (f) => (
      <>
        <label>Transportista <Req /><select name="transportista_id" required defaultValue={v(f, 'transportista_id')}>{opcionesTransportista}</select></label>
        <label>Placa <Req /><input name="placa" required placeholder="1234ABC" defaultValue={v(f, 'placa')} /></label>
        <label>Marca<input name="marca" defaultValue={v(f, 'marca')} /></label>
        <label>Capacidad (TN)<input name="capacidad_tn" inputMode="decimal" defaultValue={v(f, 'capacidad_tn')} /></label>
      </>
    ),
    ubicaciones: (f) => (
      <>
        <label>Nombre <Req /><input name="nombre" required defaultValue={v(f, 'nombre')} /></label>
        <label>Ciudad<input name="ciudad" defaultValue={v(f, 'ciudad')} /></label>
        <label>País<select name="pais" defaultValue={v(f, 'pais') ?? 'BO'}><option value="BO">Bolivia</option><option value="PE">Perú</option><option value="CL">Chile</option></select></label>
        <label>Tipo <Req />
          <select name="tipo" required defaultValue={v(f, 'tipo') ?? 'destino'}>
            {Object.entries(TIPO_UBICACION).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
          </select>
        </label>
        <SelectorUbicacion lat={v(f, 'lat')} lon={v(f, 'lon')} radio={v(f, 'radio_m') ?? '500'} />
      </>
    ),
    productos: (f) => (
      <>
        <label>Nombre <Req /><input name="nombre" required maxLength={120} placeholder="Ej. Harina Integral" defaultValue={v(f, 'nombre')} /></label>
        <label>Código interno<input name="codigo" maxLength={30} placeholder="Ej. HI-01" defaultValue={v(f, 'codigo')} /></label>
        <label>Presentación
          <input name="presentacion" maxLength={60} list="presentaciones" placeholder="Ej. Sacos de 50 kg" defaultValue={v(f, 'presentacion')} />
          <datalist id="presentaciones">
            <option value="Sacos de 50 kg" /><option value="Sacos de 40 kg" /><option value="Big bag de 1.200 kg" /><option value="Granel" />
          </datalist>
        </label>
        <label>Partida arancelaria (NANDINA)<input name="partida_arancelaria" inputMode="decimal" maxLength={14} placeholder="Ej. 1101.00.00" pattern="[0-9.]{4,14}" defaultValue={v(f, 'partida_arancelaria')} /></label>
      </>
    ),
  };

  const crear = { clientes: crearCliente, transportistas: crearTransportista, conductores: crearConductor, vehiculos: crearVehiculo, ubicaciones: crearUbicacion, productos: crearProducto }[pestana];
  const singular = { clientes: 'cliente', transportistas: 'transportista', conductores: 'chofer', vehiculos: 'vehículo', ubicaciones: 'ubicación', productos: 'producto' }[pestana];

  // ---- Tabla de cada catálogo ----
  const tablas: Record<Pestana, React.ReactNode> = {
    clientes: (
      <div className="tabla-desplazable"><table>
        <thead><tr><th>Razón social</th><th>NIT/RUC</th><th>País</th><th>WhatsApp</th><th>Comercial</th><th></th></tr></thead>
        <tbody>{filas.map((c) => (
          <tr key={c.id}><td>{v(c, 'razon_social')}</td><td>{v(c, 'nit_ruc')}</td><td>{v(c, 'pais')}</td><td>{v(c, 'whatsapp')}</td><td>{nombreComercial(c.comercial_id)}</td><td className="acciones">{enlaceEditar(c)}</td></tr>
        ))}</tbody>
      </table></div>
    ),
    transportistas: (
      <div className="tabla-desplazable"><table>
        <thead><tr><th>Transportista</th><th>NIT</th><th>Teléfono</th><th>Condiciones aceptadas</th><th></th></tr></thead>
        <tbody>{filas.map((t) => (
          <tr key={t.id}>
            <td>{v(t, 'razon_social')}</td><td>{v(t, 'nit')}</td><td>{v(t, 'telefono')}</td>
            <td>{v(t, 'clausula_rastreo_aceptada_en') ?? <span className="alerta">Pendiente</span>}</td>
            <td className="acciones">{enlaceEditar(t)}</td>
          </tr>
        ))}</tbody>
      </table></div>
    ),
    conductores: (
      <div className="tabla-desplazable"><table>
        <thead><tr><th>Chofer</th><th>Transportista</th><th>Teléfono</th><th>Estado</th><th></th></tr></thead>
        <tbody>{filas.map((c) => (
          <tr key={c.id} className={claseFila(c)}>
            <td>{v(c, 'nombre')}</td><td>{nombreTransportista(c)}</td><td>{v(c, 'telefono')}</td>
            <td>{c.activo ? 'Activo' : 'Inactivo'}</td>
            <td className="acciones">{enlaceEditar(c)} {botonActivo('conductores', c)}</td>
          </tr>
        ))}</tbody>
      </table></div>
    ),
    vehiculos: (
      <div className="tabla-desplazable"><table>
        <thead><tr><th>Placa</th><th>Marca</th><th>Capacidad</th><th>Transportista</th><th></th></tr></thead>
        <tbody>{filas.map((x) => (
          <tr key={x.id}>
            <td>{v(x, 'placa')}</td><td>{v(x, 'marca')}</td><td>{x.capacidad_tn ? `${v(x, 'capacidad_tn')} TN` : ''}</td>
            <td>{nombreTransportista(x)}</td><td className="acciones">{enlaceEditar(x)}</td>
          </tr>
        ))}</tbody>
      </table></div>
    ),
    ubicaciones: (
      <div className="tabla-desplazable"><table>
        <thead><tr><th>Nombre</th><th>Tipo</th><th>Ciudad</th><th>País</th><th>Radio</th><th>Estado</th><th></th></tr></thead>
        <tbody>{filas.map((u) => (
          <tr key={u.id} className={claseFila(u)}>
            <td>{v(u, 'nombre')}</td><td>{TIPO_UBICACION[String(u.tipo)] ?? v(u, 'tipo')}</td><td>{v(u, 'ciudad')}</td><td>{v(u, 'pais')}</td>
            <td>{v(u, 'radio_m')} m</td><td>{u.activo ? 'Activa' : 'Inactiva'}</td>
            <td className="acciones">{enlaceEditar(u)} {botonActivo('ubicaciones', u)}</td>
          </tr>
        ))}</tbody>
      </table></div>
    ),
    productos: (
      <div className="tabla-desplazable"><table>
        <thead><tr><th>Producto</th><th>Código</th><th>Presentación</th><th>Partida arancelaria</th><th>Estado</th><th></th></tr></thead>
        <tbody>{filas.map((x) => (
          <tr key={x.id} className={claseFila(x)}>
            <td>{v(x, 'nombre')}</td><td>{v(x, 'codigo')}</td><td>{v(x, 'presentacion')}</td><td>{v(x, 'partida_arancelaria')}</td>
            <td>{x.activo ? 'Activo' : 'Inactivo'}</td>
            <td className="acciones">{enlaceEditar(x)} {botonActivo('productos', x)}</td>
          </tr>
        ))}</tbody>
      </table></div>
    ),
  };

  return (
    <>
      <h1>Catálogos</h1>
      {porCorregir.length > 0 && (
        <div className="lista-telefonos" role="status">
          <strong>Teléfonos para corregir ({porCorregir.length}):</strong> no tienen código de país y el sistema no puede deducirlo.
          Mientras tanto no se arma el enlace de WhatsApp.
          <ul>
            {porCorregir.map((t) => (
              <li key={`${t.tabla}-${t.fila_id}`}>
                {NOMBRE_TABLA[t.tabla] ?? t.tabla} <strong>{t.nombre}</strong>: {t.valor} · <Link href={enlaceCorregir(t)}>Corregir</Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      <nav className="pestanas" aria-label="Catálogos">
        {PESTANAS.map((p) => (
          <Link key={p.id} href={`/catalogos?pestana=${p.id}`} className={p.id === pestana ? 'activa' : undefined} aria-current={p.id === pestana ? 'page' : undefined}>
            {p.titulo}
          </Link>
        ))}
      </nav>

      <section className="tarjeta">
        {sp.guardado && !editando && <div role="status" className="mensaje-ok">Cambios guardados.</div>}
        {error && <div className="mensaje-error">No se pudo cargar la lista: {error.message}</div>}

        {editando ? (
          <div className="edicion">
            <h2>Editar {singular}</h2>
            <FormularioCatalogo
              key={editando.id}
              accion={actualizarRegistro.bind(null, pestana, editando.id)}
              boton="Guardar cambios"
              cancelar={url()}
            >
              {campos[pestana](editando)}
            </FormularioCatalogo>
          </div>
        ) : (
          <details className="agregar">
            <summary>+ Agregar {singular}</summary>
            {pestana === 'ubicaciones' && (
              <p className="ayuda">El radio define la geocerca (fábrica ~800 m, frontera ~1.500 m).</p>
            )}
            {pestana === 'productos' && (
              <p className="ayuda">Los productos se eligen en pedidos y misiones y agrupan los reportes. Un producto usado no se borra: se desactiva y deja de ofrecerse en las listas.</p>
            )}
            <FormularioCatalogo accion={crear} boton={`Guardar ${singular}`}>
              {campos[pestana]()}
            </FormularioCatalogo>
          </details>
        )}
        <p className="ayuda"><span className="obligatorio">*</span> Dato obligatorio.</p>

        {filas.length === 0 ? <p>Todavía no hay registros. Use «Agregar {singular}».</p> : tablas[pestana]}
      </section>
      {pestana === 'transportistas' && <SeccionOperadores transportistas={transportistasData ?? []} />}
    </>
  );
}
