# asyncdv-docs

Servidor MCP que documenta un proyecto de código en un vault de Obsidian. Qué es y cómo se configura: README.md.

## Al usar el MCP desde esta carpeta

@docs/instrucciones-ia.md

## Al desarrollar el MCP

- `pnpm run verificar` (tsc + node --test) antes de dar algo por terminado.
- TypeScript sin compilar (type stripping de Node 24+): solo sintaxis borrable (`erasableSyntaxOnly`) e imports con extensión `.ts`.
- Identificadores, mensajes y comentarios en español. Los errores llevan un código estable (`ErrorMcp`) y nunca rutas absolutas ni contenido de notas.
- `src/guardia.ts` es la única puerta al vault, `src/cambios.ts` el único que prepara cambios (contenido de la nota, código, vencimiento y vista previa) y `src/aplicar.ts` el único camino que escribe. Solo `src/repo.ts` lanza procesos (git) y nada usa la red: `test/endurecimiento.test.ts` lo exige.
- Las herramientas de `src/herramientas/` solo parsean, llaman y responden. El texto libre lo limpia el dominio: cada `preparar*` aplica `limpiarTextoLibre` (`src/dominio.ts`) a sus datos antes de usarlos, así que una herramienta nueva no puede olvidarlo.
- Una opción nueva lleva: esquema con valor por defecto en `src/config.ts`, documentación en `docs/configuracion.md` y, si es una clave simple, su variable `ASYNCDV_DOCS_*` en `CLAVES_ENTORNO`.
- Nada específico de un proyecto en el código: lo propio de cada repo va en la configuración.
- Al subir de versión, cambia `src/version.ts`, `package.json` y `CHANGELOG.md`.

## Agent skills

### Issue tracker

Las issues viven en GitHub Issues del repo (CLI `gh`). Ver `docs/agents/issue-tracker.md`.

### Triage labels

Etiquetas por defecto: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. Ver `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` en la raíz y ADR en `docs/adr/`. Ver `docs/agents/domain.md`.
