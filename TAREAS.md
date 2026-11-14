# Backlog inicial para crear Issues en GitHub

## Etapa 1 — MVP seguro conectado a Drive

- [ ] **SEC-01** Autenticación de trabajadores (Google OAuth o sistema acordado), sesiones y logout.
- [ ] **SEC-02** Autorización por roles: validar quién puede ver/editar cada bitácora.
- [ ] **DRV-01** Configurar proyecto Google Cloud, consentimiento OAuth, ámbitos mínimos y credenciales fuera de Git.
- [ ] **DRV-02** Listar carpetas de personas → subcarpetas de bitácoras → Google Docs con la API de Drive.
- [ ] **DRV-03** Sincronización: identificar renombres, altas, bajas y errores de permisos.
- [ ] **UX-01** Paginación, búsqueda y filtros para muchos usuarios.
- [ ] **QA-01** Tests de integración para acceso y sincronización; datos ficticios.

## Etapa 2 — Notificaciones y resumen

- [ ] **NOT-01** Detectar cambios reales de Drive/Docs con mecanismo de cambios/webhooks, según capacidades de API.
- [ ] **NOT-02** Determinar documento cambiado y destinatarios; manejar eventos duplicados y expiración de suscripciones.
- [ ] **NOT-03** Enviar emails autorizados; guardar resultado, reintentar fallas y agrupar cambios cercanos.
- [ ] **AI-01** Leer el texto de Docs con autorización y tratar documentos largos.
- [ ] **AI-02** Crear resumen por persona con avisos de incertidumbre y referencias a la bitácora de origen.
- [ ] **AI-03** Revisar privacidad, retención, costos y evaluación de errores/alucinaciones.

## Etapa 3 — Calendario y despliegue

- [ ] **CAL-01** Acordar si usar Google Calendar compartido o solo agenda interna.
- [ ] **CAL-02** Integrar la API de Calendar con permisos específicos, si se elige Google.
- [ ] **MOB-01** Probar en móviles y con lector de pantalla.
- [ ] **OPS-01** TLS, variables secretas, backups, monitoreo y despliegue privado con login.
- [ ] **OPS-02** Política de cambios, auditoría por trabajador y recuperación ante fallos.
