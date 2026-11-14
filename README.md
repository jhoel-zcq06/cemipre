# CEMIPRE · Plataforma colaborativa de bitácoras

Prototipo universitario **local** para organizar personas usuarias y sus bitácoras, registrar enlaces a Google Docs y gestionar una agenda de prueba. El objetivo es permitir que el equipo desarrolle el proyecto en paralelo y conecte los servicios reales por etapas.

> [!WARNING]
> **NO usar datos personales ni publicar este MVP en Internet.** No tiene autenticación de trabajadores ni control de permisos. La base de datos de ejemplo contiene solo información inventada. Google Drive, Gmail, Google Calendar y la IA todavía **no están integrados**. El resumen mostrado es una simulación explícitamente identificada.

## Funciones que ya existen

- Listar, buscar y registrar personas usuarias (códigos de ejemplo).
- Mostrar unas siete bitácoras por persona y crear nuevas fichas.
- Guardar o corregir un enlace seguro de Google Docs y abrirlo en otra pestaña. Los cambios al contenido **se hacen en Google Docs**, no aquí.
- Mostrar un **resumen ilustrativo sin IA**, armado a partir de extractos inventados en SQLite.
- Crear, listar y eliminar eventos en un calendario local (todavía no en Google Calendar).
- Ver un registro de los cambios realizados **en esta plataforma**, no de las ediciones en Google Docs.
- Diseño oscuro, responsive y usable por teclado en funciones principales.
- API Django con validación básica y protección CSRF en operaciones de escritura.
- Pruebas automáticas iniciales para el backend y CI en GitHub Actions.

## Tecnologías

| Parte | Tecnología |
| --- | --- |
| Frontend | React + Vite + CSS |
| Backend | Django 5.2 LTS (API JSON) |
| Base de datos local | SQLite |
| Futuras integraciones | Google Drive/Docs, correo, modelo de IA, Google Calendar |

## Requisitos

- Python 3.10+ (recomendado Python 3.12 o 3.13)
- Node.js 20.19+ (o 22+)
- Git (para trabajo colaborativo)
- Internet **durante la instalación** de paquetes Python y Node. Luego se puede usar en modo local.

## Instalación en macOS / Linux

Abre una terminal en la carpeta del repositorio y ejecuta lo siguiente.

### Terminal 1: backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python manage.py migrate
python manage.py seed_demo
python manage.py runserver 127.0.0.1:8000
```

En Windows PowerShell, la activación es `.venv\Scripts\Activate.ps1` en lugar de `source ...`.

### Terminal 2: frontend

Desde la carpeta raíz del repositorio:

```bash
cd frontend
npm install
npm run dev
```

Abre **http://127.0.0.1:5173** en el navegador. La interfaz llamará a Django mediante el proxy configurado en `frontend/vite.config.js`.

Si aparecen errores de conexión, comprueba que ambas terminales siguen en ejecución. El endpoint **http://127.0.0.1:8000/api/health/** debe devolver un JSON con `status: ok`.

### Ejecutar pruebas

```bash
cd backend
source .venv/bin/activate
python manage.py test
python manage.py check
```

Prueba de compilación del frontend:

```bash
cd frontend
npm run build
```

## Estructura

```text
cemipre-plataforma/
├── backend/
│   ├── cemipre/              # Configuración Django y rutas principales
│   ├── core/
│   │   ├── models.py         # Personas, bitácoras, eventos, actividad
│   │   ├── views.py          # Endpoints de la API
│   │   ├── urls.py
│   │   ├── tests.py          # Pruebas de backend
│   │   ├── migrations/
│   │   └── management/commands/seed_demo.py
│   ├── requirements.txt
│   └── manage.py
├── frontend/
│   ├── src/
│   │   ├── App.jsx           # Pantallas principales y formularios
│   │   ├── api.js            # Cliente de la API Django
│   │   ├── styles.css        # Estilos responsive
│   │   └── main.jsx
│   ├── package.json
│   └── vite.config.js
├── docs/INTEGRACIONES.md
├── TAREAS.md
├── CONTRIBUTING.md
└── .github/workflows/ci.yml
```

## API disponible

| Método | Ruta | Función |
| --- | --- | --- |
| GET | `/api/health/` | Estado del backend |
| GET | `/api/personas/` | Listar personas y cantidad de bitácoras |
| POST | `/api/personas/` | Crear persona de prueba |
| GET | `/api/personas/<id>/` | Detalle y bitácoras |
| GET | `/api/personas/<id>/resumen/` | Resumen ficticio **sin IA** |
| POST | `/api/bitacoras/` | Registrar una ficha de bitácora |
| PATCH | `/api/bitacoras/<id>/` | Cambiar título o enlace Docs |
| GET | `/api/eventos/` | Listar agenda local |
| POST | `/api/eventos/` | Crear evento en agenda local |
| DELETE | `/api/eventos/<id>/` | Eliminar evento local |
| GET | `/api/actividad/` | Historial de cambios internos |
| GET | `/api/csrf/` | Establecer cookie CSRF para escrituras |

El cliente React ya gestiona las cookies CSRF. La API deliberadamente **no implementa autenticación**: eso debe agregarse **antes** de usar datos verdaderos o exponer la aplicación públicamente.

## Cómo subir a GitHub

1. Crea un repositorio **privado** vacío llamado `cemipre-plataforma` en GitHub, sin marcar “Add a README” (este proyecto ya tiene uno).
2. Desde la carpeta descomprimida, ejecuta:

```bash
git init
git add .
git commit -m "MVP inicial CEMIPRE"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/cemipre-plataforma.git
git push -u origin main
```

Reemplaza `TU-USUARIO` por el usuario u organización propietarios del repositorio. Si Git solicita autenticación, sigue el flujo de acceso de GitHub; no uses contraseñas dentro del código.

3. En GitHub ve a **Settings → Collaborators and teams** (o **Collaborators**) y agrega a tus compañeros.
4. Para que nadie sobrescriba el trabajo de otro, crea una rama por funcionalidad y usa *Pull Requests*. Revisa `CONTRIBUTING.md`.

## Antes de un despliegue real

1. Autenticación (OAuth o usuarios institucionales) y autorización por persona/bitácora.
2. Confirmar permisos y titularidad de la cuenta y carpetas de Google Drive; evitar acceso indiscriminado a información sensible.
3. Conectar y sincronizar Drive/Docs en el backend con consentimiento/autorización.
4. Detector de cambios de documentos y **envío real** de notificaciones por correo, con control de duplicados.
5. Resúmenes IA sobre documentos realmente autorizados: minimización de datos, consentimiento según corresponda, revisión humana, manejo de errores y trazabilidad.
6. Calendario compartido real (si se aprueba) y permisos de edición.
7. Gestión segura de secretos, TLS, backups, logs, monitoreo y despliegue.

Ver el plan de integración en `docs/INTEGRACIONES.md` y el reparto sugerido en `TAREAS.md`.
