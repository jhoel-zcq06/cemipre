# Guía para colaborar

## Flujo de trabajo GitHub

**No trabajen directamente en `main`.** Crea una rama propia desde la última versión:

```bash
git checkout main
git pull origin main
git checkout -b feat/nombre-funcionalidad
```

Haz cambios pequeños, ejecuta las pruebas (`cd frontend && npm test && npm run build`) y registra el avance:

```bash
git add .
git commit -m "feat: agrega ..."
git push -u origin feat/nombre-funcionalidad
```

En GitHub crea un **Pull Request** de tu rama hacia `main`, solicita revisión a un compañero y combina después de aprobar y pasar el workflow de CI. **Nunca** suban archivos `.env.local`, claves JSON de Google Cloud, tokens ni datos personales reales de CEMIPRE al repositorio.

### Convención para commits

- `feat:` nueva función
- `fix:` reparación de un error
- `docs:` documentación
- `test:` pruebas
- `chore:` tareas de configuración o limpieza
- `refactor:` cambios internos sin alterar comportamiento

### Qué debe incluir cada Pull Request

1. Qué cambió y para qué.
2. Cómo reproducir o probar el cambio (`npm test`, migración SQL o Edge Function).
3. Captura si cambió la interfaz (siempre con datos ficticios).
4. Consideraciones de seguridad, RLS o privacidad.

Consulta `TAREAS.md` para el seguimiento del backlog del equipo.
