# Guía de uso y capacitación · Plataforma CEMIPRE

Manual práctico para trabajadores, profesionales y administradores de la **Fundación CEMIPRE**.

## 1. Ingreso y activación de cuenta

1. Abre la dirección web de la plataforma entregada por el equipo de coordinación.
2. Si ya tienes cuenta, inicia sesión con tu **correo y contraseña** o usando **Continuar con Google**.
3. Si eres nuevo en el equipo, presiona la pestaña **Registrarse**, escribe tu nombre completo, correo y contraseña.
4. Tu cuenta quedará inicialmente en estado **pendiente**. Un administrador debe aprobar tu acceso en la pestaña **Administración** (a menos que tu correo haya sido agregado previamente a la lista blanca).
5. Una vez aprobado, presiona **Verificar si ya fui aprobado** para entrar al panel principal.

## 2. Secciones principales

- **Inicio:** Muestra el total de usuarios, bitácoras vinculadas, próximos eventos, estado de sincronización con Google Drive, actividad reciente y tus usuarios favoritos.
- **Usuarios:** Lista buscable y paginada de personas atendidas (identificadas por código y nombre). Al seleccionar un usuario puedes:
  - Marcarlo como **★ Favorito** para tener acceso rápido.
  - Ver todas sus bitácoras y abrir cada Google Doc en una nueva pestaña (**Abrir ↗**).
  - Agregar o configurar el enlace de Google Docs de una ficha (**Configurar**).
  - Generar un **Resumen IA** con citas a cada bitácora fuente.
  - Escribir **Notas internas del equipo** para coordinación operativa.
- **Bitácoras:** Directorio completo de documentos con filtros (*Todas*, *Vinculadas*, *Sin enlace*, *Con alerta Drive*).
- **Resúmenes IA:** Vista enfocada para consultar el panorama general, avances recientes, acciones pendientes e incertidumbres de cualquier usuario.
  > **Importante:** Todo resumen generado por IA es un apoyo informativo y **siempre requiere revisión profesional** antes de tomar decisiones clínicas o sociales.
- **Calendario:** Agenda compartida del equipo para crear, editar y eliminar reuniones o actividades (horario oficial de Chile).
- **Actividad:** Registro cronológico de qué trabajador creó, editó o sincronizó elementos dentro de la plataforma.
- **Avisos:** Historial de notificaciones por correo enviadas cuando alguien edita un Google Doc en Google Drive. Puedes activar o silenciar tus avisos haciendo clic en tu nombre arriba a la derecha (**Mi perfil y notificaciones**).
- **Carpetas Drive:** Permite ejecutar manualmente una sincronización inmediata con Google Drive para detectar documentos nuevos, renombres o archivos sin permiso de lectura.
- **Administración (solo rol `admin`):** Permite aprobar cuentas nuevas (`pendiente` → `trabajador` o `admin`) y gestionar la lista blanca automática de correos.

## 3. Accesibilidad por teclado y lector de pantalla

La plataforma está diseñada para operarse 100% con teclado y lectores de pantalla (**NVDA** en Windows o **VoiceOver** en macOS/iOS):

- Al abrir la página, presiona `Tab` una vez para activar el enlace **Saltar al contenido** e ir directo al área de trabajo.
- Usa `Tab` y `Shift + Tab` para moverte entre botones, buscadores, pestañas y listas; usa `Enter` o `Espacio` para activar botones.
- Todos los formularios emergentes (modales) mantienen el foco dentro del diálogo mientras están abiertos; presiona `Escape` para cerrarlos y el foco volverá automáticamente al botón original.
- Los mensajes de éxito, error y generación de resúmenes IA cuentan con regiones `aria-live` para que el lector de pantalla los anuncie automáticamente.
