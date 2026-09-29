# asyncdv-docs

Servidor MCP que documenta un proyecto de código en un vault de Obsidian. Qué es y cómo se configura: README.md.

## Al usar el MCP desde esta carpeta

@docs/instrucciones-ia.md

## Al desarrollar el MCP

- `pnpm run verificar` (tsc + node --test) antes de dar algo por terminado.
- TypeScript sin compilar (type stripping de Node 24+): solo sintaxis borrable (`erasableSyntaxOnly`) e imports con extensión `.ts`.
- Identificadores, mensajes y comentarios en español. Los errores llevan un código estable (`ErrorMcp`) y nunca rutas absolutas ni contenido de notas.
- `src/guardia.ts` es la única puerta al vault y `src/aplicar.ts` el único camino que escribe. Solo `src/repo.ts` lanza procesos (git) y nada usa la red: `test/endurecimiento.test.ts` lo exige.
- Una opción nueva lleva: esquema con valor por defecto en `src/config.ts`, documentación en `docs/configuracion.md` y, si es una clave simple, su variable `ASYNCDV_DOCS_*` en `CLAVES_ENTORNO`.
- Nada específico de un proyecto en el código: lo propio de cada repo va en la configuración.
- Al subir de versión, cambia `src/version.ts`, `package.json` y `CHANGELOG.md`.
