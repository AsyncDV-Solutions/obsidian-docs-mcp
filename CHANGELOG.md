# Cambios

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y las versiones, [SemVer](https://semver.org/lang/es/).

## Sin publicar

### Corregido
- `notas_desactualizadas` sin `git_path` responde `GIT_NO_CONFIGURADO`. Antes omitía todas las fuentes y decía que ninguna nota había quedado atrás. Ahora solo se omite una fuente cuando git falla, por ejemplo porque su SHA no está en el clon.
- Un fallo de git al buscar migraciones destructivas ya no se toma por «sin coincidencias»: `release_proponer` responde `GIT` en vez de proponer una versión sin esa señal. `git grep` termina con 1 tanto cuando no encuentra nada como cuando no puede leer un objeto, así que esa salida solo se acepta si git no escribió nada en stderr.
- Alcanzar el tope de escrituras por minuto (`LIMITE`) ya no consume el código de confirmación: en cuanto pasa la ventana, `cambio_aplicar` se puede reintentar con el mismo código.
- El `motivo` de `tarea_cambiar_estado` y el `criterio_nuevo` de `tarea_actualizar` con espacios sobrantes ya no llegan sin recortar a la nota: se validaban y se descartaba el valor recortado.

### Cambiado
- Los filtros `depende_de` y `release` de `items_listar` comparan el id exacto. Un enlace a la nota coincide con su slug, con un ancla `#`, con una referencia `^` o con la extensión `.md`. `DEM-T-0001 copia` o `DEM-T-0001x` ya no coinciden con `DEM-T-0001`, y un prefijo como `DEM-T` ya no coincide con todo lo que empieza así.
- El tope de tamaño y la prohibición de `%% asyncdv:` valen ahora para todo el texto que entra en una nota, no solo para los campos que ya se revisaban, y el error nombra el campo con su posición (`«criterios[1]»`, `«secciones.corregido[1]»`) en vez de solo el campo o del genérico `«item»`. Los códigos `CAMPO_GRANDE` y `CAMPO_INVALIDO` siguen igual.
- Interno: las herramientas de `src/herramientas/` guardan menos reglas de dominio. El aviso de `merge --ff-only` viaja en la propuesta de release; la regla de los docs históricos y la lectura de la cuenta de divergencia, en `repo.ts`; el estado de cada tipo de nota, el conteo de `proyecto_estado` y la lectura de una nota por id o por ruta, en `notas.ts`; los permisos de Node, en `arranque.ts`; y las fuentes con commit `repo:<ruta>@<sha>`, que se escribían en una herramienta y se leían en `mantenimiento.ts`, en `src/fuentes.ts`, que también define el patrón del SHA. `SOLO_LECTURA` es una sola constante. Lo que responden las herramientas que se tocaron no cambia: lo fijan pruebas escritas antes de mover cada regla.
- Interno: los tipos de nota se declaran en `src/tipos.ts`: la letra del id, si se numeran, la clave de su carpeta y el contrato de la plantilla, con el formato anterior de la guía. `ids.ts`, `plantillas.ts`, el arranque y `crear` leen de ahí, y `crear` deja de repetir el tipo y de pedir la carpeta. Un tipo nuevo pide además su carpeta en la configuración y su lugar en `TIPOS` y `TIPOS_ITEM`, que una prueba vigila. En `cambios.ts` hay una sola operación, las propiedades son un registro (al editar, `undefined` no se toca y `null` quita; al crear, ambos se omiten), y `editar` y `regenerarBloque` comparten cómo abren una nota, cómo exigen un bloque y cómo preparan el reemplazo. Las funcionalidades y las guías se crean con un mismo ayudante, que resuelve los pendientes antes que las relacionadas, como ya hacía la guía. Las plantillas propias de `plantillas_dir` y el formato anterior de la guía siguen funcionando.
- Interno: una sesión (`src/sesion.ts`) reúne lo que el servidor necesita mientras corre: el contexto del arranque, con el guardia, más el almacén de códigos de confirmación, el tope de escrituras por minuto, el escritor y el índice bajo demanda; una prueba le pone un reloj o un escritor de mentira. Los preparadores, `aplicar` y las herramientas reciben la sesión en vez de repetir `(ctx, guardia, índice)`, y el tope sale de `cambios.ts`: `aplicar` lo comprueba, retira el código y cuenta la escritura a la vista. `pedido_por` se resuelve dentro del preparador, después de validar el texto, así que con un texto inválido y sin `pedido_por` se responde el error del texto. El nombre que sale, también el del usuario configurado, pasa por la misma limpieza. Las pruebas crean su sesión con reloj o escritor de mentira: el vencimiento, el tope y los fallos `PARCIAL` y `ESCRITURA` se prueban sin esperar ni romper el disco.
- Interno: git se consulta por intención. `src/git.ts` define `ConsultasGit`, con trece consultas de solo lectura, y es el único módulo que lanza procesos; `release`, `mantenimiento` y las herramientas del repo dejaron de armar comandos y de interpretar su salida. Las rutas que recibe git se toman de forma literal, sin comodines ni sintaxis de pathspec, y la divergencia entre ramas solo informa «no disponible» cuando git falla. Las pruebas usan un git de mentira para ejercitar las decisiones y los fallos sin lanzar git.
- Interno: el formato de los ids, sus enlaces y sus contadores viven en `src/ids.ts`, y el bloqueo de escritura, en `src/escritura.ts`. El índice, el tablero, `iniciar`, la configuración y los esquemas de las herramientas lo derivan de ahí. Un solo lector de enlaces reemplaza a dos que aceptaban reglas distintas.
- Interno: los preparadores limpian el texto al entrar y `prepararTareaNueva` devuelve la tarea repetida; los adaptadores de `herramientas/` quedan en parsear, llamar y responder, y sus esquemas comunes viven en `herramientas/comun.ts`.
- La vista previa de crear un release cierra el contenido con `———`, como las demás creaciones, y todo reemplazo se rotula `Cambios en <ruta>:` (antes, crear una nota numerada decía `Actualizar _contadores.md:`).
- Un bloque gestionado se escribe siempre con los saltos de línea de la nota: una nota nunca queda mezclada LF/CRLF.
- Los avisos y los mensajes de conflicto son los mismos para todos los tipos de nota: el aviso del tablero dice «el bloque «tablero»», editar un release avisa si su bloque fue editado a mano, y editar una nota que cambió después de leerla responde «cambió desde que la leíste».
- Interno: un solo módulo, `src/cambios.ts`, prepara todos los cambios (crear, editar y regenerar un bloque, con su vista previa; el código y su vencimiento los guarda el almacén de la sesión). Desaparecen `confirmaciones.ts` y `creacion.ts`.

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
