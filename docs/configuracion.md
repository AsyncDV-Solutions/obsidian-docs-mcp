# Configuración

asyncdv-docs se configura con un archivo `config.json`, con variables de entorno o con ambos.

## De dónde sale la configuración

1. **Archivo**: `--config <ruta absoluta>` o la variable `ASYNCDV_DOCS_CONFIG`. Es opcional.
2. **Variables de entorno** `ASYNCDV_DOCS_<CLAVE>`: pisan lo que diga el archivo. Sirven para las claves simples de la tabla de abajo.
3. **Valores por defecto** para todo lo demás.

Las listas y los objetos (`areas`, `carpetas`, `repo`, `release`, `limites`…) solo se pueden dar en el archivo. Las variables vacías se ignoran.

Ejemplos listos para copiar: [`ejemplos/config.ejemplo.json`](../ejemplos/config.ejemplo.json) (lo mínimo) y [`ejemplos/config.completo.json`](../ejemplos/config.completo.json) (todas las opciones).

> Pon `config.json` **fuera** del vault y del repo que documentas: el servidor se niega a arrancar si está dentro.

## Claves simples (archivo o variable de entorno)

| Clave | Variable de entorno | Obligatoria | Qué es |
|---|---|---|---|
| `project_id` | `ASYNCDV_DOCS_PROJECT_ID` | sí | Identificador del proyecto: minúsculas, dígitos y guiones (`mi-app`). Va en cada nota. |
| `project_name` | `ASYNCDV_DOCS_PROJECT_NAME` | no | Nombre legible (`Mi App`), sin comillas dobles, `$`, `` ` `` ni `\`. Aparece en las descripciones de las herramientas y en el mensaje del tag. Por defecto, `project_id`. |
| `id_prefix` | `ASYNCDV_DOCS_ID_PREFIX` | sí | Prefijo de los IDs, de 2 a 5 mayúsculas (`APP` → `APP-T-0001`). |
| `repo_path` | `ASYNCDV_DOCS_REPO_PATH` | sí | Ruta absoluta del repo que se documenta (solo lectura). |
| `vault_path` | `ASYNCDV_DOCS_VAULT_PATH` | sí | Ruta absoluta de la raíz del vault de Obsidian. |
| `project_dir` | `ASYNCDV_DOCS_PROJECT_DIR` | sí | Carpeta del proyecto **dentro** del vault, con `/` (`Proyectos/mi-app`). Es lo único que el MCP puede escribir. |
| `zona_horaria` | `ASYNCDV_DOCS_ZONA_HORARIA` | sí | Zona IANA para fechas: `America/Santiago`, `Europe/Madrid`, `America/Mexico_City`, `UTC`… |
| `git_path` | `ASYNCDV_DOCS_GIT_PATH` | no* | Ruta absoluta de git. *Sin ella, las herramientas del repo quedan bloqueadas. `pnpm run iniciar` te sugiere la tuya. Puede ser un enlace (como `/opt/homebrew/bin/git`): se resuelve al arrancar y se ejecuta el archivo real. |
| `usuario` | `ASYNCDV_DOCS_USUARIO` | no | Nombre que se usa en `pedido_por` cuando el modelo no indica otro. |
| `state_dir` | `ASYNCDV_DOCS_STATE_DIR` | no | Carpeta de logs y del bloqueo de escritura. Ver abajo. |
| `plantillas_dir` | `ASYNCDV_DOCS_PLANTILLAS_DIR` | no | Carpeta con tus propias plantillas. Ver abajo. |

Las rutas absolutas son `C:\…` en Windows y `/…` en macOS y Linux. No se aceptan rutas de red (`\\servidor\…`).

### Carpeta de estado (`state_dir`)

Guarda `logs/mcp.log` (rotativo, 1 MB, sin contenido de notas) y `escritura.lock`. Si no la indicas:

- con archivo de configuración: la carpeta de `config.json`;
- sin archivo: `%APPDATA%\asyncdv-docs-mcp` (Windows), `~/Library/Application Support/asyncdv-docs-mcp` (macOS) o `$XDG_STATE_HOME/asyncdv-docs-mcp`, que por defecto es `~/.local/state/asyncdv-docs-mcp` (Linux).

Se crea si falta, pero nunca dentro del vault ni del repo.

## Opciones del archivo

### `carpetas`

Dónde van las notas de cada tipo, relativas a `project_dir`. Admiten subcarpetas (`Trabajo/Tareas`).

```json
"carpetas": {
  "tareas": "Tareas",
  "funcionalidades": "Funcionalidades",
  "decisiones": "Decisiones",
  "incidencias": "Incidencias",
  "releases": "Releases",
  "guias": "Guias"
}
```

Esos son los valores por defecto. Las carpetas deben existir: `pnpm run iniciar` las crea.

### `areas` y `ambientes`

Las listas cerradas que ofrecen las herramientas. Minúsculas, dígitos y guiones.

- `areas` (por defecto): `frontend`, `backend`, `bd`, `infra`, `ci-cd`, `seguridad`, `docs`, `ops`.
- `ambientes` de una incidencia (por defecto): `produccion`, `staging`, `local`, `repositorio`.

### `repo`: qué puede ver el MCP del repo

El MCP solo ve lo que calza con una **categoría** de la lista de permitidos. Todo lo demás es invisible.

```json
"repo": {
  "categorias": [
    { "clave": "api", "descripcion": "API", "carpetas": ["api"], "extensiones": [".ts"] },
    { "clave": "docs", "descripcion": "Documentación", "carpetas": ["docs"], "archivos": ["README.md"], "extensiones": [".md"] },
    { "clave": "vistas", "descripcion": "Vistas", "carpetas": ["src/views"], "extensiones": [".vue"], "leer_carpetas": false }
  ],
  "excluir": ["docs/legal/**", "**/clientes/**"]
}
```

Cada categoría tiene:

| Campo | Qué es |
|---|---|
| `clave` | Nombre corto (minúsculas, dígitos y `_`). Es el filtro de `repo_inventario`. |
| `descripcion` | Texto para el inventario. |
| `carpetas` | Carpetas cuyos archivos se listan (con las `extensiones` indicadas). |
| `archivos` | Archivos sueltos que siempre se pueden leer. |
| `extensiones` | Extensiones que cuentan dentro de `carpetas`, en minúsculas (`.ts`). |
| `leer_carpetas` | `false`: de las carpetas solo se ven los nombres, no el contenido. Por defecto, `true`. |

Si defines `categorias`, **reemplazan** a las de por defecto: `docs`, `manifiesto`, `codigo` (`src`, `app`, `lib`, `packages`), `pruebas`, `bd`, `workflows`, `prompts` y `scripts_ci`. Revisa [`src/config.ts`](../src/config.ts) para ver el detalle.

`excluir` suma patrones que ganan siempre, aunque la ruta calce con una categoría:

- `**/` cualquier número de carpetas; `/**` al final: la carpeta y todo lo que contiene;
- `*` cualquier texto dentro de un segmento; `?` un carácter;
- no distingue mayúsculas de minúsculas.

Además hay **exclusiones fijas** que no se pueden desactivar: `.env*`, `.dev.vars*`, `.npmrc`, `.pypirc`, `.netrc`, llaves (`*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.jks`, `*.keystore`, `id_rsa*`…), `node_modules`, `dist` y `.git`.

`docs_historicos` marca documentos del repo que están desactualizados, para que el modelo prefiera el código. Un `*` final marca un prefijo: `["docs/viejo.md", "docs/fase1-*"]`.

### `release`: propuesta de versión

```json
"release": {
  "rama_principal": "main",
  "rama_desarrollo": "develop",
  "lista_verificacion": ["El CI terminó en verde para {head}", "Revisaste estas notas"],
  "migraciones": { "carpeta": "db/migrations", "marcador_destructivo": "-- destructiva" },
  "senales": [{ "prefijo": "api/", "mensaje": "Cambió la API pública: revisa los contratos." }]
}
```

| Campo | Qué hace |
|---|---|
| `rama_principal` | Rama que analiza `release_proponer` por defecto (`main`). |
| `rama_desarrollo` | Si la indicas, se informa la divergencia entre ambas ramas y se agrega a la lista de verificación. |
| `lista_verificacion` | Casillas que deben cumplirse antes del tag. `{head}` se reemplaza por el commit. |
| `migraciones` | Si una migración nueva de esa carpeta contiene `marcador_destructivo`, el bump sube a **major**. |
| `senales` | Si cambió algún archivo que empieza con `prefijo`, la propuesta muestra `mensaje`. |

La versión se calcula con Conventional Commits (`fix` → patch, `feat` → minor, `!` o `BREAKING CHANGE` → major) sobre los tags `v*`. El MCP nunca crea tags: solo propone los comandos.

### `plantillas_dir`: tus propias plantillas

Una carpeta con archivos `tarea.md`, `funcionalidad.md`, `incidencia.md`, `decision.md`, `release.md` o `guia.md`. Los que falten se toman de [`plantillas/`](../plantillas). Así puedes cambiar títulos de secciones o el idioma sin tocar el código.

Cada plantilla debe conservar sus campos `{{…}}` y sus bloques gestionados (`%% asyncdv:inicio … %%` / `%% asyncdv:fin %%`): el servidor lo comprueba al arrancar y no arranca si falta algo. La carpeta no puede estar dentro del vault. Si cambias una plantilla, reinicia el servidor.

Una `guia.md` propia con el formato anterior a la 2.1.0 (campos `{{proposito}}`, `{{pasos}}`, `{{problemas}}`, `{{afirmaciones}}` y `{{pendientes}}`, sin bloques) se sigue aceptando. Las guías que crea no se pueden editar con `guia_actualizar`: para eso, copia la estructura de bloques de [`plantillas/guia.md`](../plantillas/guia.md).

### `limites`

Topes de seguridad. Todos tienen un valor por defecto y rara vez hace falta tocarlos.

| Clave | Por defecto | Qué limita |
|---|---|---|
| `nota_max_kb` | 256 | Tamaño de una nota. |
| `yaml_max_kb` | 16 | Tamaño de las propiedades de una nota. |
| `campo_max_kb` | 64 | Tamaño de un campo de texto que envía el modelo. |
| `repo_archivo_max_kb` | 64 | Tamaño de un archivo del repo que se puede leer. |
| `resultados_max` | 50 | Resultados de una búsqueda o un listado. |
| `notas_max` | 5000 | Notas que se indexan. |
| `escrituras_por_minuto` | 10 | Aplicaciones de cambios por minuto. |
| `confirmacion_minutos` | 5 | Vigencia de un código de confirmación. |
| `git_timeout_ms` | 5000 | Tiempo máximo de cada llamada a git. |

## La carpeta del proyecto en el vault

`pnpm run iniciar` la deja lista. Si prefieres hacerlo a mano, necesitas:

- `_proyecto.md`: el marcador. Sus propiedades deben coincidir con la configuración:

  ```yaml
  ---
  project_id: mi-app
  type: proyecto
  id_prefix: APP
  schema: 1
  title: Mi App
  ---
  ```

- `_contadores.md`: `project_id`, `type: contadores`, `schema: 1` y `ultimo_T`, `ultimo_F`, `ultimo_I`, `ultimo_ADR`, `ultimo_G` en `0`.
- `Tablero.md`: `project_id`, `type: referencia`, `schema: 1` y, en el cuerpo, las líneas `%% asyncdv:inicio tablero %%` y `%% asyncdv:fin %%`.
- Las carpetas de `carpetas`.

## Diagnóstico

Si algo falla, pídele al modelo que llame a `proyecto_estado`: lista cada problema de configuración con su código (`CONFIG_ESQUEMA`, `RUTA_NO_EXISTE`, `MARCADOR_AJENO`…). También puedes volver a correr `pnpm run iniciar`, que valida todo sin tocar lo que ya existe.
