# Guía para colaborar

## Flujo de trabajo GitHub

**No trabajen directamente en `main`.** Crea una rama propia desde la última versión:

```bash
git checkout main
git pull origin main
git checkout -b feat/nombre-funcionalidad
```

Haz cambios pequeños, pruébalos localmente y registra el avance:

```bash
git add .
git commit -m "feat: agrega vista de ..."
git push -u origin feat/nombre-funcionalidad
```

En GitHub crea un **Pull Request** de tu rama hacia `main`, solicita revisión a un compañero y combina después de aprobar y pasar las pruebas. No añadan tokens, claves, documentos reales ni bases de datos `.sqlite3` al repositorio.

### Convención para commits

- `feat:` nueva función
- `fix:` reparación de un error
- `docs:` documentación
- `test:` pruebas
- `refactor:` cambios internos sin alterar comportamiento

### Ideas para dividir el equipo

- **Frontend:** UI, buscador, formularios, móvil, accesibilidad.
- **Backend:** modelos, endpoints, autenticación y validaciones.
- **Drive/Docs:** listar carpetas, sincronización, permisos y enlaces.
- **Integraciones:** correo y notificaciones, resúmenes IA, calendario.
- **QA:** pruebas automáticas, despliegue seguro y documentación.

No se conectan servicios reales mediante claves compartidas por chat. Cada desarrollador usará un archivo `.env` local ignorado por Git, o un gestor de secretos.

### Qué debe incluir cada Pull Request

1. Qué cambió y para qué.
2. Cómo reproducir o probar el cambio.
3. Captura si cambió la interfaz (sin datos personales).
4. Riesgos de seguridad o acceso a datos.
5. Issue que resuelve, si existe.

Consulta `TAREAS.md` para las primeras tareas del equipo.
