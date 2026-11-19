# Guía técnica de integraciones y despliegue

Esta guía detalla la configuración de Google Cloud, Supabase Edge Functions, proveedores de IA/correo y despliegue web en producción.

## 1. Google Cloud: OAuth 2.0 privado para Drive y Docs (Recomendado)

Con OAuth 2.0, cada trabajador puede autenticarse con Google, explorar sus carpetas/bitácoras privadas directamente desde la plataforma y el sistema sincroniza automáticamente en segundo plano **sin necesidad de dejar enlaces públicos ("Cualquier persona con el enlace")**.

1. Ingresa a **Google Cloud Console** y selecciona tu proyecto.
2. En **APIs y servicios → Biblioteca**, habilita:
   - **Google Drive API**
   - **Google Docs API**
3. Configura la **Pantalla de consentimiento de OAuth**:
   - **Si usas Google Workspace (`@cemipre.cl`):** selecciona tipo **Interno**. Los tokens no caducan cada 7 días y no requiere verificación externa.
   - **Si usas cuentas `@gmail.com` personales:** selecciona tipo **Externo** en estado **En pruebas (Testing)** y agrega los correos del equipo en *Usuarios de prueba* (hasta 100). *(Nota: en modo Prueba Google caduca el `refresh_token` cada 7 días; la app muestra un aviso de reconexión en 1 clic y puede usar Service Account como respaldo silencioso).*
4. En **APIs y servicios → Credenciales → Crear credenciales → ID de cliente OAuth** (tipo **Aplicación web**), agrega **ambas** URIs de redirección autorizadas:
   - `https://<PROJECT_REF>.supabase.co/auth/v1/callback` *(para login con Google en Supabase Auth)*
   - `https://<PROJECT_REF>.supabase.co/functions/v1/google-drive-auth` *(para conectar/reconectar Google Drive offline desde la app)*
5. En **Supabase → Authentication → Providers → Google**, pega el mismo **Client ID** y **Client Secret**.
6. En **Supabase Edge Function Secrets**, guarda:
   - `GOOGLE_OAUTH_CLIENT_ID`
   - `GOOGLE_OAUTH_CLIENT_SECRET`
   - `GOOGLE_TOKEN_ENCRYPTION_KEY` (clave aleatoria de 32+ caracteres para cifrar tokens con AES-256-GCM en `private.google_oauth_tokens`)
   - `APP_BASE_URL` (tu dominio de producción, ej. `https://tu-app.vercel.app`)
7. Una vez desplegado, entra como administrador a **Carpetas Drive**, pulsa **Conectar cuenta Google CEMIPRE** y elige la **Carpeta raíz** directamente desde el selector de Google Drive.

### Respaldo opcional: Service Account para Drive y Docs

1. Si deseas mantener un respaldo adicional (útil para cuentas `@gmail.com` si pasan >7 días sin reconectar), ve a **IAM y administración → Cuentas de servicio** y crea una Service Account (ej. `cemipre-lector-docs`).
2. En la pestaña **Claves**, crea una clave JSON y descárgala **fuera de este repositorio** (nunca la subas a Git).
3. Comparte la carpeta raíz de usuarios de CEMIPRE en Google Drive con el correo `client_email` de la Service Account con permiso **Lector**.
4. Copia el contenido completo del JSON (en una sola línea) como secreto `GOOGLE_SERVICE_ACCOUNT_JSON` en Supabase.

### Cómo funcionan `_shared/google.ts`, `google-drive-auth` y `drive-browser`
- Los tokens OAuth se guardan cifrados con **AES-256-GCM** en `private.google_oauth_tokens` (esquema inaccesible desde `anon`/`authenticated`), gestionados únicamente mediante funciones `SECURITY DEFINER` otorgadas solo a `service_role`.
- `drive-browser` usa exclusivamente el token OAuth del trabajador autenticado para explorar *Mi unidad*, *Compartidos conmigo* y *Unidades compartidas* sin exponer tokens en el navegador.
- `sync-drive` se ejecuta automáticamente cada 5 minutos vía GitHub Actions (`notificar-cambios.yml`) o `pg_cron`, al vincular una carpeta de usuario y al retomar la app tras el cooldown, usando candado atómico anti-duplicados (`sync_lock_until`).
- `resumen-usuario` y `crear-bitacora-drive` usan la cadena inteligente de credenciales: **OAuth del trabajador → OAuth institucional → Service Account opcional**.

### Creación automática de carpeta + Google Doc (`crear-bitacora-drive`)
- Cuando se agrega una bitácora sin seleccionar ni pegar un enlace existente, `crear-bitacora-drive` crea automáticamente en Drive una carpeta y un Google Doc usando la cuenta Google OAuth conectada (sin chocar con el límite de 0 GB de las Service Accounts y sin necesidad de publicar un Apps Script).
- El puente [apps_script_drive_bridge.gs](apps_script_drive_bridge.gs) se mantiene únicamente como respaldo legado si no hay cuenta OAuth conectada.

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
