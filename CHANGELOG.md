# Cambios

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y las versiones, [SemVer](https://semver.org/lang/es/).

## 2.1.1 — 2026-09-29

### Corregido
- `git_path` puede ser un enlace, como el git de Homebrew en macOS (`/opt/homebrew/bin/git → ../Cellar/git/<versión>/bin/git`). Antes el servidor no arrancaba (`RUTA_ENLACE`), también con la ruta que sugiere `pnpm run iniciar`. Ahora el enlace se resuelve una vez al arrancar y se ejecuta el archivo real. Con los permisos de Node basta `--allow-fs-read=<git_path>`. Esto dejaba en rojo la CI de macOS.
- Una `git_path` que es una carpeta da `GIT_NO_ARCHIVO`.

## 2.1.0 — 2026-09-29

### Añadido
- `guia_actualizar`: prepara cambios en una guía existente con vista previa. Puede cambiar el título, el propósito, los pasos, los problemas frecuentes, las afirmaciones, `evidence`, `reviewed_commit`, las fuentes, el área, las relacionadas y los pendientes. Sigue las mismas reglas que `funcionalidad_actualizar`: la key no cambia, y cambiar afirmaciones, fuentes o `evidence` exige `reviewed_commit`.

### Cambiado
- La plantilla de guía por defecto guarda su contenido en bloques gestionados, igual que la de funcionalidad. Suma una sección «Notas», que el MCP no toca, y un historial.
- Una `guia.md` propia (`plantillas_dir`) con el formato anterior, basado en campos `{{…}}`, se sigue aceptando: crea guías, pero sin bloques, así que `guia_actualizar` no puede editarlas (responde `BLOQUE_FALTA`).

## 2.0.0 — 2026-09-29

Primera versión pública: todo lo propio de un proyecto pasa a la configuración.

### Añadido
- Configuración por variables de entorno `ASYNCDV_DOCS_*` (pisan a `config.json`) y `ASYNCDV_DOCS_CONFIG` en lugar de `--config`. El archivo pasa a ser opcional.
- Opciones nuevas: `project_name`, `usuario` (valor por defecto de `pedido_por`), `state_dir`, `plantillas_dir`, `carpetas`, `areas`, `ambientes`, `repo.categorias`, `repo.excluir` y `release` (ramas, lista de verificación, migraciones destructivas y señales). Ver `docs/configuracion.md`.
- `pnpm run iniciar`: prepara la carpeta del proyecto en el vault (carpetas, `_proyecto.md`, `_contadores.md`, `Tablero.md`) sin sobrescribir nada, valida la configuración y muestra cómo registrar el servidor.
- Soporte para macOS y Linux, y CI en Windows, macOS y Linux.
- Guías para registrar el servidor en Claude Code, Claude Desktop, Cursor, VS Code, Windsurf, Codex CLI y Gemini CLI, y reglas para el agente (`docs/instrucciones-ia.md`).

### Cambiado
- **Incompatible**: sin `repo.categorias`, la lista de permitidos del repo es genérica (docs, manifiestos, `src`/`app`/`lib`/`packages`, pruebas, migraciones y `.github`). Las categorías, exclusiones y señales de release del proyecto original se mueven a su configuración.
- **Incompatible**: las áreas por defecto son `frontend`, `backend`, `bd`, `infra`, `ci-cd`, `seguridad`, `docs` y `ops`.
- **Incompatible**: `repo_git_resumen` y `release_proponer` solo informan la divergencia entre ramas si se configura `release.rama_desarrollo`.
- `pedido_por` es opcional si hay `usuario` configurado.
- Node 24 **o posterior** (antes, solo 24.x).
- La plantilla de release trae secciones genéricas; con `plantillas_dir` puedes usar las tuyas.

## 1.2.0

- `funcionalidad_actualizar`: el contenido de una funcionalidad vive en bloques gestionados que se pueden reescribir con vista previa.

## 1.1.0

- `guia_crear` y categorías del repo para prompts y scripts de CI.

## 1.0.0

- Tareas, funcionalidades, decisiones, incidencias, tablero, releases y notas desactualizadas, con escritura en dos pasos (vista previa y confirmación).
