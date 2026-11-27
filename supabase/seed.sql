-- =============================================================================
-- Datos iniciales para desarrollo local (supabase db reset).
-- Coordenadas APROXIMADAS: confirme la ubicación exacta de la fábrica y de los
-- pasos fronterizos en Google Maps antes del piloto y ajuste el radio.
-- =============================================================================
insert into public.ubicaciones (nombre, ciudad, pais, tipo, lat, lon, radio_m) values
  ('Fábrica Industrias Reynales', 'Monteagudo',  'BO', 'fabrica',    -19.8050, -63.9560,  800),
  ('Paso fronterizo Desaguadero', 'Desaguadero', 'BO', 'frontera',   -16.5660, -69.0390, 1500),
  ('Santa Cruz de la Sierra',     'Santa Cruz',  'BO', 'destino',    -17.7833, -63.1821, 3000),
  ('La Paz',                      'La Paz',      'BO', 'destino',    -16.4955, -68.1336, 3000),
  ('Puno',                        'Puno',        'PE', 'destino',    -15.8402, -70.0219, 3000),
  ('Arequipa',                    'Arequipa',    'PE', 'destino',    -16.4090, -71.5375, 3000),
  ('Cochabamba',                  'Cochabamba',  'BO', 'punto_ruta', -17.3895, -66.1568, 3000),
  ('Patacamaya',                  'Patacamaya',  'BO', 'punto_ruta', -17.2370, -67.9220, 2000);

-- Datos de demostración (puede borrarlos).
insert into public.clientes (razon_social, nit_ruc, pais, contacto, whatsapp)
values ('Cliente de prueba S.A.C.', '20123456789', 'PE', 'Juan Pérez', '+51900000000');

insert into public.transportistas (razon_social, nit, contacto, telefono)
values ('Transportes de prueba', '1234567', 'Dueño de prueba', '+59170000000');

insert into public.conductores (transportista_id, nombre, ci, telefono)
select id, 'Chofer de prueba', '1234567 CH', '+59171111111' from public.transportistas limit 1;

insert into public.vehiculos (transportista_id, placa, marca, capacidad_tn)
select id, '1234ABC', 'Volvo', 30 from public.transportistas limit 1;
