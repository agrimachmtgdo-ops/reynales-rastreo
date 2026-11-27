# Rastreo de camiones · Industrias Reynales

Sistema para conocer en todo momento dónde están los camiones que salen de la fábrica de
Monteagudo hacia Bolivia y Perú (vía Desaguadero). Sigue el
[plan de desarrollo](https://claude.ai/artifact/6PT8wM8WhrstC3EMvuRDvq).

Esta primera entrega cubre la base del **MVP interno**: base de datos con seguridad, panel de
despacho y app del chofer que envía posiciones.

## Cómo funciona

```
 App del chofer (Android)                     Supabase (São Paulo)                  Panel de despacho (web)
 ─────────────────────────                    ────────────────────                  ───────────────────────
 1. Escribe/escanea el código  ──activar──▶   invitaciones_chofer                    Crea misión y camión
 2. Acepta la política         ──aceptar──▶   consentimientos                  ◀──   Genera código + QR + WhatsApp
 3. "Iniciar viaje"            ──etapa────▶   asignaciones.etapa
 4. GPS cada ~45 s, guarda en               ▶ posiciones (por mes)
    el teléfono y envía por    ──lotes────▶   geocercas → etapa automática  ──tiempo real──▶ Mapa y lista en vivo
    lotes cada 2,5 min (5 en Perú)            eventos                                  Modo manual de etapa
 5. "Entregado"                ──etapa────▶   se cierra el acceso del chofer
```

- **Chofer:** no tiene usuario ni contraseña. El teléfono abre una sesión anónima y el código de
  invitación lo liga a **un solo camión, un solo viaje y un solo teléfono**. El GPS se enciende con
  "Iniciar viaje" y se apaga con "Entregado". Sin mapa en su pantalla para ahorrar datos.
- **Etapas automáticas (geocercas PostGIS):** sale de la fábrica → *En ruta*; entra a Desaguadero →
  *En frontera*; sale de la frontera hacia el destino → *Cruzó frontera*. El chofer también puede
  marcarlas, y despacho puede corregirlas en modo manual.
- **Datos móviles:** formato compacto (6 números por posición), envío por lotes, menos puntos cuando el
  camión está detenido y envío cada 5 minutos en Perú. Estimado: **0,5 a 1,5 MB por día de viaje**
  (meta del plan: menos de 3 MB). La app muestra al chofer cuántos MB lleva usados.

## Estructura del repositorio

| Carpeta | Qué contiene |
| --- | --- |
| `supabase/migrations/` | Esquema de base de datos, en orden: tipos, tablas, posiciones particionadas, seguridad RLS, etapas/geocercas y funciones del despacho, funciones del chofer, tiempo real y política de rastreo |
| `supabase/seed.sql` | Ubicaciones iniciales (fábrica, Desaguadero, destinos) y datos de prueba |
| `supabase/tests/` | Prueba de punta a punta del flujo de un viaje (32 verificaciones) |
| `apps/despacho/` | Panel web (Next.js): tablero en vivo con mapa, misiones, invitaciones, catálogos |
| `apps/chofer/` | App Android (Expo / React Native): activación, consentimiento, botones de etapa y GPS en segundo plano |
| `packages/shared/` | Código común: etapas, formato compacto de posiciones y colores de marca |
| `docs/GUIA-CONFIGURACION.md` | **Pasos para poner todo en marcha (empiece aquí)** |

## Seguridad (resumen)

- Todas las tablas tienen **Row Level Security**. El personal activo lee; solo administrador y despacho
  modifican; gerencia solo lee. Los visitantes sin sesión no ven ninguna tabla.
- Quien se registra con correo queda **inactivo** hasta que un administrador le asigna rol.
- El chofer nunca lee tablas: usa funciones del servidor que validan su invitación, su consentimiento y
  la etapa del viaje. Un código usado en un teléfono no sirve en otro.
- Las posiciones con ubicación simulada ("GPS falso") se guardan marcadas y generan una incidencia.

## Comandos

```bash
pnpm install          # instala todo
pnpm despacho         # panel en http://localhost:3000
pnpm chofer           # servidor de desarrollo de la app (requiere una "development build", ver guía)
pnpm typecheck        # revisa tipos en todo el proyecto
pnpm db:test          # prueba las migraciones en un PostgreSQL local con PostGIS
```

## Pendiente para las siguientes entregas

1. Segundo factor (TOTP) obligatorio para administrador y despacho.
2. Enlace público del cliente (MVP cliente) con retraso de 15 minutos y posición aproximada en paradas.
3. Alertas internas (sin señal, detención, ubicación simulada) y guardia rotativa.
4. Foto de entrega, documentos con PIN, ETA y avisos por WhatsApp (Fase 2).
5. Publicar el panel en internet y la app en Google Play (prueba cerrada).
6. Tarea programada para crear particiones futuras y borrar posiciones de más de 12 meses.
7. Límite de intentos al activar códigos (protección contra prueba masiva de códigos) y CAPTCHA en el ingreso anónimo.
