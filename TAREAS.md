# Backlog y estado de implementación · CEMIPRE (React + Supabase + Google Docs)

## Bloque 1 — Base común e infraestructura

- [x] **OPS-01** Retirar `backend/` (Django), eliminar proxy `/api` en `vite.config.js`, actualizar CI (`.github/workflows/ci.yml`), `vercel.json` y documentación (`README.md`, `docs/INTEGRACIONES.md`).
- [x] **SEC-01** Pantalla accesible `LoginView.jsx` (Email/Contraseña + Google OAuth), manejo de sesión en `App.jsx` y vista informativa para rol `pendiente`.
- [x] **SEC-02 / OPS-02** Migración `0002_auth_y_rls.sql`: tabla `perfiles`, lista blanca `emails_autorizados`, trigger `on_auth_user_created`, protección contra cambio de rol, eliminación de políticas `demo_*`, políticas RLS estrictas (`es_trabajador_autorizado()` / `es_admin()`) y auditoría (`actor_id`, `actor_nombre`).
- [x] **DRV-01 / DRV-02** Conector compartido `supabase/functions/_shared/google.ts` en Deno (firma JWT RS256 nativa con Web Crypto API, token cache, exportación de texto de Google Docs y listado de carpetas/cambios).

## Bloque 2 — Funciones clave en paralelo

- [x] **DRV-03** Migración `0003_drive_sync_y_notificaciones.sql`, Edge Function `sync-drive/index.ts` y vista `CarpetasDriveView` conectada.
- [x] **AI-01 / AI-02 / AI-03** Edge Function `resumen-usuario/index.ts` (lectura real de Docs, minimización de RUT/email/teléfono/nombre, manejo por bloques, soporte Gemini/OpenAI, referencias a bitácora fuente, aviso de revisión profesional) y vista `ResumenesIAView`.
- [x] **NOT-01 / NOT-02 / NOT-03** Edge Function `notificar-cambios/index.ts` (protegida con `CRON_SECRET`, Google Drive Changes API, agrupación anti-spam de autoguardados, correos sin datos clínicos sensibles vía Resend/Webhook), migración `0004_cron_notificaciones.sql`, workflow `.github/workflows/notificar-cambios.yml` y vista `AvisosCorreoView`.
- [x] **UX-01 / CAL-01** CRUD completo de usuarios/bitácoras/eventos, paginación y filtros, migración `0005_ux_favoritos_y_comentarios.sql` (favoritos y comentarios internos por trabajador en Supabase) y toggle de notificaciones en perfil.

## Bloque 3 — QA, Accesibilidad y Entrega operacional

- [x] **QA-01** Suite Vitest configurada en `frontend/` con pruebas en `frontend/src/api.test.js` (validación URLs Google Docs, extracción de ID, fechas, mapeo, errores y accesibilidad de modales/avisos).
- [x] **MOB-01 (Código)** Trampa de foco y retorno de foco en `Modals.jsx`, atributos `aria-live`, skip-link, contraste y diseño responsive.
- [ ] **OPS-DESPLIEGUE** Tareas operacionales en la nube del equipo: crear proyecto Supabase, aplicar migraciones, compartir carpeta real de Drive con la Service Account, cargar secretos (`GOOGLE_SERVICE_ACCOUNT_JSON`, `AI_API_KEY`, `EMAIL_API_KEY`, `CRON_SECRET`) y desplegar en Vercel.
- [ ] **QA-ENVIVO** Pruebas reales en staging/producción (verificación RLS con rol `pendiente`, lectura de Doc real de prueba, verificación NVDA/VoiceOver en dispositivo móvil y capacitación presencial con `docs/GUIA_USO_CEMIPRE.md`).
