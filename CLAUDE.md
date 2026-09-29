# asyncdv-docs

Servidor MCP que documenta un proyecto de código en un vault de Obsidian. Qué es y cómo se configura: README.md.

## Al usar el MCP desde esta carpeta

@docs/instrucciones-ia.md

## Al desarrollar el MCP

- `pnpm run verificar` (tsc + node --test) antes de dar algo por terminado.
- TypeScript sin compilar (type stripping de Node 24+): solo sintaxis borrable (`erasableSyntaxOnly`) e imports con extensión `.ts`.
- Identificadores, mensajes y comentarios en español. Los errores llevan un código estable (`ErrorMcp`) y nunca rutas absolutas ni contenido de notas.
- `src/guardia.ts` es la única puerta al vault, `src/cambios.ts` el único que prepara cambios (contenido de la nota y vista previa) y `src/aplicar.ts` el único camino que escribe los cambios preparados, y solo por el escritor de la sesión (`iniciar` crea las notas del sistema al preparar el proyecto).
- La sesión (`src/sesion.ts`) es lo que reciben los preparadores, `aplicar` y las herramientas: el contexto del arranque, con el guardia, más el almacén de códigos y su vencimiento, el tope de escrituras, el escritor y el índice bajo demanda. Solo `src/arranque.ts` construye el guardia y solo `src/sesion.ts` el almacén y el tope. Una prueba crea su propia sesión, con reloj o escritor de mentira si le importa el tiempo o un fallo de disco. Solo `src/git.ts` lanza procesos, y lo hace por consultas con intención (`ConsultasGit`): nadie más arma comandos de git. Nada usa la red. `test/endurecimiento.test.ts` lo vigila.
- Las herramientas de `src/herramientas/` solo parsean, llaman y responden. El texto libre lo limpia el dominio: cada `preparar*` de `tareas.ts`, `documentos.ts` y `release.ts` aplica `limpiarTextoLibre` (`src/dominio.ts`) a sus datos antes de usarlos, y `test/endurecimiento.test.ts` lo exige. `pedido_por` se resuelve después, dentro del preparador, con `quienPide`. `prepararTablero` no recibe texto.
- Los tipos de nota se declaran en `src/tipos.ts`: la letra de su id, si se numeran, la clave de su carpeta en `config.carpetas` y el contrato de su plantilla, con el formato anterior de la guía. Los ids, las plantillas, el arranque y `crear` leen de ahí. Un tipo nuevo pide además su carpeta en `config.carpetas`, su lugar en `TIPOS` y `TIPOS_ITEM` de `src/dominio.ts` (`test/tipos.test.ts` vigila los tres), su plantilla y su preparador.
- El formato de un id, de su prefijo y de sus enlaces lo define solo `src/ids.ts`, con las letras de `src/tipos.ts`: los esquemas de las herramientas, el índice, el tablero e `iniciar` lo derivan de ahí, y `test/endurecimiento.test.ts` lo exige.
- Las fuentes con commit (`repo:<ruta>@<sha>`) y el patrón del SHA los define solo `src/fuentes.ts`; `test/endurecimiento.test.ts` vigila las formas habituales de hacerlo a mano en otro archivo.
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
