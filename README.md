# CEMIPRE · Plataforma colaborativa de bitácoras

Plataforma web centralizada para la **Fundación CEMIPRE** (Viña del Mar) para gestionar fichas de personas usuarias, vincular y sincronizar sus bitácoras en **Google Docs**, recibir avisos automáticos por correo ante modificaciones y generar resúmenes asistidos por **IA**.

> [!IMPORTANT]
> **Privacidad y datos reales:** Carga datos reales de personas atendidas únicamente después de aplicar las migraciones de autenticación y Row Level Security (`supabase/migrations/0002_auth_y_rls.sql`), activar Supabase Auth y aprobar los perfiles del equipo.

## Arquitectura (React + Supabase + Google Docs)

| Capa | Tecnología | Ubicación |
| --- | --- | --- |
| Interfaz web | React 19 + Vite + CSS accesible | `frontend/` |
| Base de datos y Auth | Supabase (PostgreSQL + RLS + Supabase Auth) | `supabase/schema.sql`, `supabase/migrations/` |
| Lógica de servidor | Supabase Edge Functions (Deno TypeScript) | `supabase/functions/` |
| Documentos colaborativos | Google Drive API + Google Docs API (Service Account) | `supabase/functions/_shared/google.ts` |
| Resúmenes IA | Gemini API o OpenAI API (con minimización previa) | `supabase/functions/resumen-usuario/` |
| Notificaciones | Resend / Webhook + `pg_cron` o GitHub Actions | `supabase/functions/notificar-cambios/` |

## Estructura del repositorio

```text
cemipre-plataforma/
├── frontend/
│   ├── src/
│   │   ├── App.jsx                   # Sesión Supabase, navegación y estado global
│   │   ├── api.js                    # Cliente Supabase, validaciones y Edge Functions
│   │   ├── api.test.js               # Pruebas unitarias y accesibilidad (Vitest)
│   │   ├── styles.css                # Tema oscuro accesible y responsive
│   │   └── components/
│   │       ├── LoginView.jsx         # Login Email/Google y pantalla rol pendiente
│   │       ├── Modals.jsx            # Modales con focus trap y retorno de foco
│   │       ├── SharedUI.jsx          # Paginación, avisos aria-live y resumen IA
│   │       ├── DashboardViews.jsx    # Inicio, Resúmenes IA y Favoritos
│   │       └── WorkspaceViews.jsx    # Usuarios, Bitácoras, Calendario, Drive, Avisos, Admin
│   ├── .env.example
│   ├── package.json
│   └── vite.config.js
├── supabase/
│   ├── schema.sql                    # Esquema base
│   ├── seed.sql                      # Datos ficticios para desarrollo
│   ├── config.toml                   # Configuración Supabase CLI
│   ├── .env.example                  # Plantilla de secretos para Edge Functions
│   ├── migrations/
│   │   ├── 0001_schema_inicial.sql
│   │   ├── 0002_auth_y_rls.sql
│   │   ├── 0003_drive_sync_y_notificaciones.sql
│   │   ├── 0004_cron_notificaciones.sql
│   │   └── 0005_ux_favoritos_y_comentarios.sql
│   └── functions/
│       ├── _shared/                  # CORS, Auth JWT y conector Google RS256
│       ├── sync-drive/               # Sincronización de carpetas y Docs
│       ├── resumen-usuario/          # Lectura real de Docs + resumen IA
│       └── notificar-cambios/        # Drive Changes API + envío de correos
├── docs/
│   ├── INTEGRACIONES.md              # Guía técnica Google Cloud, IA, correo y deploy
│   └── GUIA_USO_CEMIPRE.md           # Guía de capacitación para trabajadores
├── .github/workflows/
│   ├── ci.yml                        # Tests Vitest, build Vite, Deno check y control secretos
│   └── notificar-cambios.yml         # Scheduler cada 10 min (alternativa Free Tier)
└── vercel.json                       # Configuración de despliegue SPA en Vercel
```

## Requisitos previos

- **Node.js** 20.19+ (o 22+) y `npm`
- **Cuenta y proyecto en Supabase** (https://supabase.com)
- **Supabase CLI** (opcional para desarrollo/despliegue de Edge Functions desde terminal)
- **Google Cloud Project** con Google Drive API y Google Docs API habilitadas (Service Account)

## Puesta en marcha local (Frontend)

1. Instala dependencias del frontend:

```bash
cd frontend
npm install
```

2. Crea tu archivo de entorno local (ignorado por Git):

```bash
cp .env.example .env.local
```

Completa `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` con las credenciales públicas (**Project Settings → API**) de tu proyecto Supabase.

3. Ejecuta las pruebas, compila o inicia el servidor de desarrollo:

```bash
npm test         # Ejecuta las pruebas unitarias con Vitest
npm run dev      # Inicia Vite en http://127.0.0.1:5173
npm run build    # Compila la versión de producción en frontend/dist/
```

## Configuración de Supabase (Base de datos y Auth)

1. En **SQL Editor** de Supabase (o usando `supabase db push` tras `supabase link`), ejecuta en orden:
   - `supabase/migrations/0001_schema_inicial.sql` (o `supabase/schema.sql`)
   - `supabase/migrations/0002_auth_y_rls.sql`
   - `supabase/migrations/0003_drive_sync_y_notificaciones.sql`
   - `supabase/migrations/0004_cron_notificaciones.sql`
   - `supabase/migrations/0005_ux_favoritos_y_comentarios.sql`
   - `supabase/migrations/0006_jerarquia_admin_secreta.sql`
   - *(Opcional solo en entorno de pruebas)* `supabase/seed.sql`
2. En **Authentication → Providers**, activa **Email** y, si el equipo lo requiere, **Google** (configurando Redirect URL hacia tu dominio / `http://127.0.0.1:5173`).
3. Registra la primera cuenta de administrador en la app y promuévela una sola vez desde SQL Editor:

```sql
update public.perfiles
set rol = 'admin'
where email = 'tu-correo@cemipre.cl';
```

Desde ese momento el administrador puede aprobar cuentas nuevas o añadir correos a la lista blanca directamente desde la pestaña **Administración** de la plataforma.

## Despliegue de Edge Functions y Secretos

Con Supabase CLI autenticado (`supabase login` y `supabase link --project-ref <REF>`):

```bash
supabase secrets set \
  GOOGLE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}' \
  GOOGLE_DRIVE_ROOT_FOLDER_ID='ID_CARPETA_RAIZ' \
  AI_PROVIDER='gemini' \
  AI_API_KEY='TU_CLAVE_AI' \
  EMAIL_PROVIDER='resend' \
  EMAIL_API_KEY='TU_CLAVE_RESEND' \
  EMAIL_FROM='CEMIPRE <notificaciones@tudominio.cl>' \
  CRON_SECRET='secreto-largo-aleatorio' \
  APP_BASE_URL='https://tu-app.vercel.app'

supabase functions deploy sync-drive
supabase functions deploy resumen-usuario
supabase functions deploy notificar-cambios
supabase functions deploy crear-bitacora-drive
```

> [!WARNING]
> **Pausa automática en Supabase Free Tier:** Si el proyecto permanece en el plan gratuito de Supabase, puede pausarse tras varios días consecutivos sin tráfico. El workflow `.github/workflows/notificar-cambios.yml` ayuda a generar actividad periódica y notificar ediciones, pero para operación continua institucional se recomienda evaluar el plan Pro o definir un monitoreo activo.

Consulta [docs/INTEGRACIONES.md](docs/INTEGRACIONES.md) para el paso a paso de Google Cloud y despliegue, y [docs/GUIA_USO_CEMIPRE.md](docs/GUIA_USO_CEMIPRE.md) para el manual de usuario final.
