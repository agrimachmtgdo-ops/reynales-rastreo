# Guía de configuración (paso a paso)

Esta guía explica, en orden, lo que usted debe hacer para probar el sistema. Todo lo indicado aquí
usa **planes gratuitos**; no se contrata nada con costo. Cada cuenta debe crearse con un correo de
Industrias Reynales (no personal), como recomienda el plan.

Tiempo estimado: 1 a 2 horas la primera vez.

---

## Paso 1. Crear el proyecto en Supabase (base de datos)

1. Entre a <https://supabase.com> y cree una cuenta con el correo de la fábrica.
2. Pulse **New project** y complete:
   - **Name:** `reynales-rastreo`
   - **Database password:** genere una y **guárdela en un lugar seguro** (la necesitará en el paso 2).
   - **Region:** *South America (São Paulo)*.
   - **Plan:** *Free* para las pruebas.
3. Espere 1 o 2 minutos a que el proyecto termine de crearse.

> **Costo:** el plan gratuito sirve para el piloto, pero se pausa tras 7 días sin uso y no tiene
> copias de seguridad diarias. Para la operación real se recomienda el plan Pro (aprox. USD 25/mes);
> esa decisión la toma usted más adelante.

## Paso 2. Cargar el esquema de la base de datos

**Opción A (recomendada, desde su computadora):**

1. Instale [Node.js 22 LTS](https://nodejs.org) y luego, en una terminal: `npm install -g pnpm`
2. Descargue el repositorio: `git clone https://github.com/agrimachmtgdo-ops/reynales-rastreo.git`
   y entre a la carpeta: `cd reynales-rastreo`
3. Vincule el proyecto (le pedirá iniciar sesión en Supabase y la contraseña del paso 1):

   ```bash
   npx supabase login
   npx supabase link --project-ref SU_REFERENCIA
   npx supabase db push
   ```

   `SU_REFERENCIA` es el texto que aparece en la dirección del proyecto:
   `https://supabase.com/dashboard/project/SU_REFERENCIA`.

**Opción B (sin instalar nada):** en Supabase abra **SQL Editor**, y copie, pegue y ejecute **uno por
uno y en orden** los archivos de `supabase/migrations/` (del `...000100` al `...000700`).

## Paso 3. Cargar la fábrica, la frontera y los destinos

1. Abra `supabase/seed.sql` y revise las coordenadas: son **aproximadas**. Verifique en Google Maps la
   ubicación exacta de la fábrica (mantenga presionado el punto y copie los dos números).
2. En **SQL Editor**, ejecute solo el primer bloque (`insert into public.ubicaciones ...`) con las
   coordenadas corregidas. Los "datos de demostración" del final son opcionales.
3. También puede agregar ubicaciones después desde el panel, en **Catálogos**.

## Paso 4. Permitir el ingreso de los choferes

En Supabase: **Authentication → Sign In / Providers** y active **Allow anonymous sign-ins**.

Esto permite que la app del chofer abra una sesión sin correo. Es seguro porque esa sesión no ve
ningún dato hasta que el chofer escribe un código válido generado por despacho.

## Paso 5. Crear su usuario administrador

1. **Authentication → Users → Add user → Create new user**: escriba su correo y una contraseña y marque
   *Auto Confirm User*.
2. En **SQL Editor** ejecute (cambiando el correo):

   ```sql
   update public.usuarios
      set rol = 'administrador', activo = true, nombre = 'Ronald'
    where id = (select id from auth.users where email = 'su-correo@reynales.com');
   ```

3. Para el personal de despacho repita el punto 1 y luego cambie `'administrador'` por `'despacho'`
   (o `'gerencia'` para quien solo debe mirar).

## Paso 6. Copiar las claves del proyecto

En **Project Settings → API Keys** copie:

- **Project URL** (ej. `https://abcd1234.supabase.co`)
- **Publishable key** (o *anon key*). Es una clave pública: la seguridad la dan las reglas RLS.

> Nunca copie la clave **secret / service_role** en estos archivos ni la comparta.

## Paso 7. Abrir el panel de despacho en su computadora

```bash
cd apps/despacho
cp .env.example .env.local     # en Windows: copy .env.example .env.local
```

Abra `.env.local` con un editor de texto y pegue la URL y la clave del paso 6. Luego, desde la carpeta
principal del repositorio:

```bash
pnpm install
pnpm despacho
```

Abra <http://localhost:3000> e ingrese con el usuario del paso 5. En **Catálogos** registre un
cliente, un transportista, un chofer (con su número de WhatsApp) y un vehículo.

## Paso 8. Instalar la app del chofer en un teléfono Android de prueba

El rastreo con la pantalla apagada **no funciona en Expo Go**; hay que generar un archivo APK:

1. Cree una cuenta gratuita en <https://expo.dev>.
2. En la carpeta `apps/chofer`:

   ```bash
   cp .env.example .env          # pegue la misma URL y clave del paso 6
   npx eas-cli login
   npx eas-cli init              # vincula la app con su cuenta de Expo (una sola vez)
   npx eas-cli build -p android --profile piloto
   ```

3. Al terminar (15 a 30 minutos en la cola gratuita), Expo muestra un enlace y un QR para descargar el
   APK. Ábralo en el teléfono Android y acepte instalar la aplicación.

## Paso 9. Prueba completa

1. En el panel: **Misiones → Nueva misión**, elija cliente, destino y el camión.
2. En el detalle de la misión pulse **Invitar chofer**. Aparecen el código, el QR y el botón de WhatsApp.
3. En el teléfono: abra la app, escriba el código (o escanee el QR) y acepte la política.
4. Toque **Ajustes del teléfono** y siga los dos pasos (ubicación "todo el tiempo" y batería sin
   restricciones).
5. Toque **Iniciar viaje** y salga a dar una vuelta. En 2 a 3 minutos el camión aparece en el
   **Tablero** del panel, y la etapa cambia a *En ruta* al salir de la geocerca de la fábrica.
6. Toque **Entregado**: el GPS se apaga y el código deja de servir.

## Si algo falla

| Síntoma | Qué revisar |
| --- | --- |
| "Cuenta pendiente de activación" en el panel | Paso 5, punto 2 (el `update` con su correo) |
| La app dice "No se pudo conectar" | Paso 4 (sesiones anónimas) y que `.env` tenga la URL y la clave correctas |
| "Código no válido" | El código se anula al generar uno nuevo o al entregar; genere otro en el panel |
| El camión deja de aparecer con la pantalla apagada | Paso 9, punto 4 (ajustes de batería de la marca del teléfono) |
| El panel no muestra el mapa | Conexión a internet (el mapa usa OpenStreetMap) |

Para verificar la base de datos en una computadora con PostgreSQL y PostGIS: `pnpm db:test`.
