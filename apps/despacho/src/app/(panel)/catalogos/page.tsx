import { crearClienteServidor } from '@/lib/supabase/server';
import FormularioCatalogo from '@/componentes/FormularioCatalogo';
import { crearCliente, crearConductor, crearTransportista, crearUbicacion, crearVehiculo } from './acciones';

export const dynamic = 'force-dynamic';

export default async function PaginaCatalogos() {
  const supabase = await crearClienteServidor();
  const [clientes, transportistas, conductores, vehiculos, ubicaciones] = await Promise.all([
    supabase.from('clientes').select('id, razon_social, nit_ruc, pais, whatsapp').order('razon_social'),
    supabase.from('transportistas').select('id, razon_social, nit, telefono, clausula_rastreo_aceptada_en').order('razon_social'),
    supabase.from('conductores').select('id, nombre, telefono, transportista:transportistas(razon_social)').order('nombre'),
    supabase.from('vehiculos').select('id, placa, marca, capacidad_tn, transportista:transportistas(razon_social)').order('placa'),
    supabase.from('ubicaciones').select('id, nombre, ciudad, pais, tipo, radio_m').order('tipo').order('nombre'),
  ]);
  const opcionesTransportista = (transportistas.data ?? []).map((t) => (
    <option key={t.id} value={t.id}>{t.razon_social}</option>
  ));

  return (
    <>
      <h1>Catálogos</h1>

      <section className="tarjeta">
        <h2>Clientes</h2>
        <FormularioCatalogo accion={crearCliente} boton="Agregar cliente">
          <label>Razón social<input name="razon_social" required /></label>
          <label>NIT / RUC<input name="nit_ruc" /></label>
          <label>País<select name="pais"><option value="BO">Bolivia</option><option value="PE">Perú</option></select></label>
          <label>Contacto<input name="contacto" /></label>
          <label>WhatsApp<input name="whatsapp" placeholder="+51…" /></label>
          <label>Correo<input name="correo" type="email" /></label>
        </FormularioCatalogo>
        <table>
          <thead><tr><th>Razón social</th><th>NIT/RUC</th><th>País</th><th>WhatsApp</th></tr></thead>
          <tbody>
            {(clientes.data ?? []).map((c) => (
              <tr key={c.id}><td>{c.razon_social}</td><td>{c.nit_ruc}</td><td>{c.pais}</td><td>{c.whatsapp}</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="tarjeta">
        <h2>Transportistas</h2>
        <FormularioCatalogo accion={crearTransportista} boton="Agregar transportista">
          <label>Razón social o nombre del dueño<input name="razon_social" required /></label>
          <label>NIT<input name="nit" /></label>
          <label>Contacto<input name="contacto" /></label>
          <label>Teléfono<input name="telefono" /></label>
          <label>Aceptó condiciones de rastreo el<input name="clausula_rastreo_aceptada_en" type="date" /></label>
        </FormularioCatalogo>
        <table>
          <thead><tr><th>Transportista</th><th>NIT</th><th>Teléfono</th><th>Condiciones aceptadas</th></tr></thead>
          <tbody>
            {(transportistas.data ?? []).map((t) => (
              <tr key={t.id}>
                <td>{t.razon_social}</td><td>{t.nit}</td><td>{t.telefono}</td>
                <td>{t.clausula_rastreo_aceptada_en ?? <span className="alerta">Pendiente</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="tarjeta">
        <h2>Choferes</h2>
        <FormularioCatalogo accion={crearConductor} boton="Agregar chofer">
          <label>Transportista<select name="transportista_id" required>{opcionesTransportista}</select></label>
          <label>Nombre completo<input name="nombre" required /></label>
          <label>CI (uso interno)<input name="ci" /></label>
          <label>Teléfono (uso interno)<input name="telefono" placeholder="+591…" /></label>
          <label>Licencia<input name="licencia" /></label>
        </FormularioCatalogo>
        <table>
          <thead><tr><th>Chofer</th><th>Transportista</th><th>Teléfono</th></tr></thead>
          <tbody>
            {(conductores.data ?? []).map((c) => (
              <tr key={c.id}>
                <td>{c.nombre}</td>
                <td>{(c.transportista as unknown as { razon_social: string } | null)?.razon_social}</td>
                <td>{c.telefono}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="tarjeta">
        <h2>Vehículos</h2>
        <FormularioCatalogo accion={crearVehiculo} boton="Agregar vehículo">
          <label>Transportista<select name="transportista_id" required>{opcionesTransportista}</select></label>
          <label>Placa<input name="placa" required placeholder="1234ABC" /></label>
          <label>Marca<input name="marca" /></label>
          <label>Capacidad (TN)<input name="capacidad_tn" inputMode="decimal" /></label>
        </FormularioCatalogo>
        <table>
          <thead><tr><th>Placa</th><th>Marca</th><th>Capacidad</th><th>Transportista</th></tr></thead>
          <tbody>
            {(vehiculos.data ?? []).map((v) => (
              <tr key={v.id}>
                <td>{v.placa}</td><td>{v.marca}</td><td>{v.capacidad_tn ? `${v.capacidad_tn} TN` : ''}</td>
                <td>{(v.transportista as unknown as { razon_social: string } | null)?.razon_social}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="tarjeta">
        <h2>Ubicaciones y geocercas</h2>
        <p style={{ fontSize: 13, color: 'var(--gris)' }}>
          Para obtener latitud y longitud: en Google Maps, mantenga presionado el punto y copie los dos números que aparecen.
          El radio define la geocerca (fábrica ~800 m, frontera ~1.500 m).
        </p>
        <FormularioCatalogo accion={crearUbicacion} boton="Agregar ubicación">
          <label>Nombre<input name="nombre" required /></label>
          <label>Ciudad<input name="ciudad" /></label>
          <label>País<select name="pais"><option value="BO">Bolivia</option><option value="PE">Perú</option></select></label>
          <label>Tipo
            <select name="tipo" required>
              <option value="destino">Destino</option>
              <option value="fabrica">Fábrica</option>
              <option value="frontera">Frontera</option>
              <option value="punto_ruta">Punto de ruta</option>
            </select>
          </label>
          <label>Latitud<input name="lat" required inputMode="decimal" placeholder="-19.8050" /></label>
          <label>Longitud<input name="lon" required inputMode="decimal" placeholder="-63.9560" /></label>
          <label>Radio de geocerca (m)<input name="radio_m" inputMode="numeric" defaultValue={500} /></label>
        </FormularioCatalogo>
        <table>
          <thead><tr><th>Nombre</th><th>Tipo</th><th>Ciudad</th><th>País</th><th>Radio</th></tr></thead>
          <tbody>
            {(ubicaciones.data ?? []).map((u) => (
              <tr key={u.id}><td>{u.nombre}</td><td>{u.tipo}</td><td>{u.ciudad}</td><td>{u.pais}</td><td>{u.radio_m} m</td></tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
