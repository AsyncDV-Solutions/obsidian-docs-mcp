# obsidian-docs-mcp

[![CI](https://github.com/AsyncDV-Solutions/obsidian-docs-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/AsyncDV-Solutions/obsidian-docs-mcp/actions/workflows/ci.yml)
[![Licencia: MIT](https://img.shields.io/badge/licencia-MIT-blue.svg)](LICENSE)

**asyncdv-docs**, de AsyncDV Solutions: **servidor MCP local que documenta tu proyecto de código en un vault de Obsidian**, con cualquier cliente de IA compatible con MCP: Claude Code, Claude Desktop, Cursor, VS Code (Copilot), Windsurf, Codex CLI, Gemini CLI y otros.

El agente de IA lee tu repo (solo lectura, solo lo que permitas) y lleva en Obsidian:

- **Tareas e incidencias** con estados, prioridades, bloqueos, criterios de aceptación e historial, y un **tablero** generado.
- **Funcionalidades y guías de uso** con evidencia por afirmación y fuente citada (`repo:<ruta>@<sha>`), y aviso cuando el código cambió después de documentarlas.
- **Decisiones de arquitectura** (ADR) y **notas de release** con la versión propuesta a partir de git.

Nada se escribe sin tu aprobación: cada cambio devuelve primero una **vista previa** y un código de un solo uso; solo `cambio_aplicar`, con ese código, escribe.

> [English summary](#english-summary) at the end.

## Cómo funciona

```text
Cliente de IA ──stdio──▶ asyncdv-docs ──solo lectura──▶ tu repo (lista de permitidos + git)
                               │
                               └──vista previa → tu aprobación → escritura──▶ vault/<project_dir>/
```

- Escribe **únicamente** notas Markdown dentro de la carpeta del proyecto en tu vault.
- Lee del repo solo las carpetas y extensiones que configures; secretos (`.env`, llaves…) nunca.
- Sin red, sin shell: git se ejecuta con ruta absoluta y protecciones fijas.

## Requisitos

- **Node.js 24 o posterior** (ejecuta TypeScript directamente, sin compilar).
- **pnpm** (recomendado; `corepack enable` lo activa) o npm.
- **git**.
- Un **vault de Obsidian** y el **repo** que quieres documentar.
- Windows, macOS o Linux.

## Instalación en 5 pasos

**1. Descarga e instala dependencias**

```bash
git clone https://github.com/AsyncDV-Solutions/obsidian-docs-mcp.git
cd obsidian-docs-mcp
pnpm install
```

**2. Configura** con un archivo o con variables de entorno.

Con archivo: copia [`ejemplos/config.ejemplo.json`](ejemplos/config.ejemplo.json) a una carpeta **fuera** del vault y del repo (por ejemplo `%APPDATA%\asyncdv-docs-mcp\config.json` en Windows o `~/.config/asyncdv-docs/config.json` en macOS y Linux) y ajústalo:

```json
{
  "schema_version": 1,
  "project_id": "mi-app",
  "project_name": "Mi App",
  "id_prefix": "APP",
  "repo_path": "/Users/tu-usuario/dev/mi-app",
  "vault_path": "/Users/tu-usuario/Obsidian/Mi Vault",
  "project_dir": "Proyectos/mi-app",
  "zona_horaria": "America/Santiago",
  "git_path": "/usr/bin/git",
  "usuario": "Tu nombre"
}
```

O solo con variables de entorno (útil para darlas en el bloque `env` de tu cliente de IA):

| Variable | Ejemplo |
|---|---|
| `ASYNCDV_DOCS_PROJECT_ID` | `mi-app` |
| `ASYNCDV_DOCS_PROJECT_NAME` | `Mi App` |
| `ASYNCDV_DOCS_ID_PREFIX` | `APP` |
| `ASYNCDV_DOCS_REPO_PATH` | `/Users/tu-usuario/dev/mi-app` |
| `ASYNCDV_DOCS_VAULT_PATH` | `/Users/tu-usuario/Obsidian/Mi Vault` |
| `ASYNCDV_DOCS_PROJECT_DIR` | `Proyectos/mi-app` |
| `ASYNCDV_DOCS_ZONA_HORARIA` | `America/Santiago` |
| `ASYNCDV_DOCS_GIT_PATH` | `/usr/bin/git` |
| `ASYNCDV_DOCS_USUARIO` | `Tu nombre` |
| `ASYNCDV_DOCS_CONFIG` | ruta de un `config.json` (en vez de `--config`) |

Las variables pisan al archivo. Carpetas del vault, áreas, qué partes del repo ve el MCP, lista de verificación del release, plantillas propias y límites: [docs/configuracion.md](docs/configuracion.md).

**3. Prepara la carpeta del proyecto en el vault**

```bash
pnpm run iniciar --config /ruta/a/config.json
```

Crea `project_dir` con sus subcarpetas, `_proyecto.md`, `_contadores.md` y `Tablero.md`, sin tocar lo que ya exista. Luego valida todo, te sugiere `git_path` si falta e imprime cómo registrar el servidor.

**4. Registra el servidor en tu cliente de IA** con el nombre `asyncdv-docs`. En Claude Code:

```bash
claude mcp add asyncdv-docs --scope user -e ASYNCDV_DOCS_CONFIG=/ruta/a/config.json -- /ruta/absoluta/de/node /ruta/a/obsidian-docs-mcp/src/index.ts
```

Claude Desktop, Cursor, VS Code, Windsurf, Codex CLI, Gemini CLI y el modo endurecido con permisos de Node: [docs/clientes-ia.md](docs/clientes-ia.md).

**5. Dale las reglas al agente**: copia [docs/instrucciones-ia.md](docs/instrucciones-ia.md) en el `CLAUDE.md`, `AGENTS.md`, `GEMINI.md` o las reglas de tu cliente. Y pídele: *«usa proyecto_estado»*.

## Herramientas (20)

| Tipo | Herramientas |
|---|---|
| Consulta | `proyecto_estado`, `notas_buscar`, `nota_leer`, `items_listar` |
| Preparan cambios (no escriben) | `tarea_crear`, `tarea_cambiar_estado`, `tarea_actualizar`, `funcionalidad_crear`, `funcionalidad_actualizar`, `guia_crear`, `adr_crear`, `incidencia_crear`, `tablero_regenerar`, `release_borrador_guardar` |
| Escribe | `cambio_aplicar`: código de un solo uso que vence en 5 minutos. **Nunca la apruebes de forma automática.** |
| Repo (solo lectura) | `repo_inventario`, `repo_archivo_leer`, `repo_git_resumen` |
| Release y mantenimiento | `release_proponer` (solo texto: nunca crea tags), `notas_desactualizadas` |

## Comandos para Claude Code

En [`.claude/commands/`](.claude/commands) hay comandos listos: `/tarea-nueva`, `/estado`, `/tablero`, `/pendientes`, `/funcionalidad`, `/documentar` y `/release`. Funcionan en esta carpeta; para usarlos en otro proyecto, cópialos a su `.claude/commands/` o a `~/.claude/commands/`.

## Qué queda en el vault

```text
<vault>/<project_dir>/
├── _proyecto.md        marcador: project_id e id_prefix
├── _contadores.md      último número por tipo (APP-T-0007, APP-F-0003…)
├── Tablero.md          tu texto + un bloque que regenera el MCP
├── Tareas/  Funcionalidades/  Decisiones/  Incidencias/  Releases/  Guias/
```

Cada nota tiene propiedades YAML (`id`, `project_id`, `type`, `status`, `priority`, `source`…) que funcionan con Dataview y Bases. El MCP solo reescribe lo que está entre sus marcadores `%% asyncdv:inicio … %%` / `%% asyncdv:fin %%`; si alguien los editó a mano, la vista previa lo advierte. Lo demás es tuyo.

## Seguridad

- **Una sola puerta de escritura**: `cambio_aplicar`, con código de un solo uso, verificación de versión (si la nota cambió, no escribe nada), escritura atómica, bloqueo entre sesiones y tope de escrituras por minuto.
- **Guardia de rutas**: solo notas `.md` dentro de `project_dir`; sin `..`, sin ocultos, sin enlaces simbólicos, junctions ni enlaces duros, y verificación de `project_id` en cada nota.
- **Repo en solo lectura**: lista de permitidos configurable y exclusiones fijas para secretos; git sin shell, sin fetch, sin ganchos ni `fsmonitor`, y sin reescribir el índice.
- **Sin red**, y logs sin contenido de notas.
- Opcional: [modelo de permisos de Node](docs/clientes-ia.md#opcional-endurecer-con-el-modelo-de-permisos-de-node) para limitar el proceso a las carpetas necesarias.
- Si la configuración tiene problemas, todas las herramientas quedan bloqueadas y `proyecto_estado` explica por qué.

## Desarrollo

```bash
pnpm run verificar   # tsc + node --test
```

TypeScript sin compilación (type stripping de Node), dependencias mínimas (`@modelcontextprotocol/server`, `yaml`, `zod`). Las pruebas crean repos y vaults temporales, y la CI las corre en Windows, macOS y Linux. Los cambios de cada versión están en [CHANGELOG.md](CHANGELOG.md).

## Licencia

[MIT](LICENSE).

---

## English summary

**obsidian-docs-mcp** (server name `asyncdv-docs`) is a local MCP server (stdio) that lets any MCP-compatible AI client (Claude Code, Claude Desktop, Cursor, VS Code Copilot, Windsurf, Codex CLI, Gemini CLI…) document a code repository inside an Obsidian vault: tasks and incidents with a generated board, feature notes and how-to guides with per-claim evidence and `repo:<path>@<sha>` sources, ADRs, and release notes with a proposed semver bump. The repo is read-only and filtered by a configurable allowlist; every write is previewed first and applied only with a single-use confirmation code.

Setup: Node 24+, `pnpm install`, configure with `config.json` or `ASYNCDV_DOCS_*` environment variables, run `pnpm run iniciar` to scaffold the project folder in your vault, then register `node src/index.ts` in your AI client. The code, tools and docs are in Spanish; tool schemas are self-describing, so the model works in any language.
