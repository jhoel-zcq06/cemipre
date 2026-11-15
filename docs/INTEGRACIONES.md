# Guía técnica de integraciones y despliegue

Esta guía detalla la configuración de Google Cloud, Supabase Edge Functions, proveedores de IA/correo y despliegue web en producción.

## 1. Google Cloud: Service Account para Drive y Docs

1. Ingresa a **Google Cloud Console** y crea o selecciona el proyecto del equipo.
2. En **APIs y servicios → Biblioteca**, habilita:
   - **Google Drive API**
   - **Google Docs API**
3. Ve a **IAM y administración → Cuentas de servicio** y crea una Service Account (ej. `cemipre-lector-docs`).
4. En la pestaña **Claves**, crea una clave JSON y descárgala **fuera de este repositorio** (nunca la subas a Git).
5. Comparte la carpeta raíz de usuarios de CEMIPRE en Google Drive con el correo `client_email` de la Service Account con permiso **Lector**.
6. Copia el contenido completo del JSON (en una sola línea) como secreto `GOOGLE_SERVICE_ACCOUNT_JSON` en Supabase, y el ID de la carpeta compartida (la parte final de la URL `https://drive.google.com/drive/folders/<ID>`) en `GOOGLE_DRIVE_ROOT_FOLDER_ID`.

### Cómo funciona `_shared/google.ts`
- Firma un JWT `RS256` usando la **Web Crypto API** nativa de Deno (sin librerías externas).
- Solicita un `access_token` de solo lectura (`drive.readonly` y `documents.readonly`).
- `sync-drive` recorre la carpeta raíz y subcarpetas de primer nivel, detecta Google Docs nuevos, actualiza `drive_modified_time` / `drive_revision_id` / renombres, y marca errores por archivo (`sin_permiso` o `no_encontrada`) sin interrumpir el resto.

## 2. Resúmenes con IA (`resumen-usuario`)

- La Edge Function valida el JWT del trabajador en Supabase Auth y verifica que su perfil tenga rol `admin` o `trabajador`.
- Descarga el texto real de los Google Docs vinculados con `google_doc_id`.
- Si un documento no tiene enlace, fue borrado o devuelve `403`, se informa explícitamente en `incertidumbres` y `fuentes` sin inventar contenido.
- Antes de enviar el contexto al modelo:
  - Reemplaza RUTs chilenos por `[RUT-OMITIDO]`.
  - Reemplaza correos electrónicos por `[EMAIL-OMITIDO]`.
  - Reemplaza teléfonos por `[TELEFONO-OMITIDO]`.
  - Sustituye el nombre completo por `Usuario <CODIGO>`.
- Si el historial supera el presupuesto seguro de contexto (`32 000` caracteres), realiza síntesis por bloques antes del resumen final.
- Soporta **Gemini** (`AI_PROVIDER=gemini`, por defecto `gemini-3.5-flash-lite`) y **OpenAI** (`AI_PROVIDER=openai`, por defecto `gpt-4o-mini`).
- Registra en `actividad` únicamente metadatos de auditoría (sin almacenar prompts ni texto clínico).

## 3. Notificaciones automáticas (`notificar-cambios`)

- Protegida mediante cabecera `x-cron-secret` (o `Authorization: Bearer <CRON_SECRET>`).
- Usa `start_page_token` almacenado en `drive_sync_state` para consultar cambios incrementales en Google Drive Changes API.
- Filtra únicamente archivos cuyo `google_doc_id` esté vinculado en la tabla `bitacoras`.
- Consolida autoguardados seguidos dentro de `NOTIFY_DEBOUNCE_MINUTES` (por defecto `15` minutos) o misma revisión `headRevisionId`.
- Envía avisos vía **Resend** (`EMAIL_PROVIDER=resend`) o webhook externo (`EMAIL_PROVIDER=webhook`) a los perfiles con `recibir_notificaciones = true` y rol autorizado.
- **Privacidad:** el correo incluye únicamente el código/identificador del usuario, título de la bitácora, fecha en zona `America/Santiago` y enlace a la plataforma. **Nunca** incluye extractos clínicos.

### Programación periódica (cada 10 minutos)
- **Opción A (GitHub Actions - compatible con Supabase Free Tier):** Configura en **GitHub → Settings → Secrets and variables → Actions** los secretos:
  - `SUPABASE_FUNCTIONS_URL` = `https://<PROJECT_REF>.supabase.co/functions/v1`
  - `CRON_SECRET` = el mismo valor configurado en Supabase Secrets.
  El workflow `.github/workflows/notificar-cambios.yml` se ejecutará automáticamente cada 10 minutos.
- **Opción B (`pg_cron` + `pg_net` + Supabase Vault):** Guarda `cemipre_notificar_url` y `cemipre_cron_secret` en Vault y vuelve a ejecutar `supabase/migrations/0004_cron_notificaciones.sql`.

## 4. Despliegue del Frontend (Vercel / Netlify)

1. Conecta el repositorio en **Vercel** (archivo `vercel.json` ya incluido) o Netlify (`Base directory: frontend`, `Build command: npm run build`, `Publish directory: dist`).
2. Define las variables de entorno de producción:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
3. Agrega el dominio de producción en Supabase → **Authentication → URL Configuration** (`Site URL` y `Redirect URLs`).

## 5. Checklist de verificación pre-entrega

1. Confirmar que no existan claves privadas ni archivos `.env.local` en `git ls-files`.
2. Verificar con un cliente anónimo o cuenta `pendiente` que todas las tablas retornan acceso denegado por RLS.
3. Probar `resumen-usuario` sin JWT (debe responder `401`) y con usuario autorizado sobre un Google Doc de prueba.
4. Editar un Google Doc de prueba, esperar/invocar `notificar-cambios` y confirmar que llega el correo sin texto clínico sensible y queda registrado en `notificaciones_enviadas`.
