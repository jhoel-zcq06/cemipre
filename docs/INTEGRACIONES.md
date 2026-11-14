# Arquitectura de futuras integraciones

El prototipo guarda datos en SQLite y **no intenta conectar ninguna cuenta real**.

## 1. Google Drive + Docs

- Trabajador inicia sesión; el backend verifica permisos antes de cualquier consulta.
- Backend usa OAuth 2.0 y **ámbitos mínimos** para consultar el Drive autorizado.
- Enumerar carpetas de usuarios; dentro, carpetas de bitácoras; dentro, identificar el Doc correspondiente.
- Guardar en la base de datos el **ID estable** del archivo y la ruta lógica para sincronizaciones; la URL es solo un enlace de navegación.
- Abrir la bitácora en Google Docs; Google maneja colaboración y edición. **No es necesario crear un editor colaborativo propio.**
- Añadir caché, paginación y manejo de errores (permisos, archivos borrados, límites de API).

## 2. Avisos por correo

- Un trabajador edita un Google Doc desde el enlace de la plataforma.
- Un proceso backend recibe/verifica eventos de cambios disponibles desde Google Drive o consulta periódicamente cambios.
- Traducir el ID del documento al usuario y bitácora correspondientes.
- Consolidar eventos repetidos (el guardado automático puede generar varias señales).
- Enviar un correo a cada trabajador con permiso; evitar filtrar contenido sensible en el correo.
- Registrar intentos y estado; reintentar con límites.

**Importante:** el endpoint `/api/actividad/` del MVP solo muestra cambios a metadatos y eventos hechos en esta aplicación; **NO detecta modificaciones realizadas dentro de Google Docs**.

## 3. Resúmenes con IA

- Leer texto de las bitácoras a las que el trabajador tiene acceso.
- Reducir datos identificatorios si es posible y definir políticas de uso y retención del proveedor IA.
- Resumir cada bitácora y después producir un resumen agregado por usuario; manejar límites de contexto y costos.
- Incluir origen, fecha y, cuando sea posible, referencias verificables a los documentos.
- El resumen debe ser **asistido y revisable**, no sustituir el criterio profesional.

**Importante:** `/api/personas/<id>/resumen/` es un **mock local sin IA ni lectura de Google Docs**.

## 4. Google Calendar o agenda interna

La agenda interna ya es un MVP local en `core.models.Evento`. Si el equipo decide un calendario real compartido:

- Usar Google Calendar API para eventos del calendario autorizado.
- Verificar permisos de lectura/edición y la zona horaria de Chile.
- Gestionar actualización, eliminación, recurrencias y conflictos.
- Mantener el diseño web responsive, sin necesidad de una app móvil nativa.

## Privacidad y seguridad

CEMIPRE trata registros de personas. Antes de conectar fuentes reales, confirmar bases legales, consentimiento cuando aplique, control de acceso por trabajador, minimización, respaldo y eliminación de datos, responsables, trazabilidad y revisión de proveedores externos. Mantener el repositorio privado. Nunca subir PDFs, Docs exportados, tokens, emails reales ni registros reales a Issues o Pull Requests.
