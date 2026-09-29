# Registrar asyncdv-docs en tu cliente de IA

asyncdv-docs es un servidor MCP local por **stdio**: funciona con cualquier cliente compatible con MCP. En todos se registra igual: un comando (`node`), sus argumentos (la ruta de `src/index.ts`) y, opcionalmente, variables de entorno.

Antes de empezar:

1. Ten lista la configuración ([configuracion.md](configuracion.md)) y corre `pnpm run iniciar`: al final imprime el bloque exacto para tu equipo.
2. Usa la **ruta absoluta** de Node 24 o posterior. Muchos clientes no heredan el `PATH` de tu terminal (por ejemplo, Claude Desktop en macOS con nvm).
   - Windows (PowerShell): `(Get-Command node).Source` → `C:\Program Files\nodejs\node.exe`
   - macOS / Linux: `which node` → `/usr/local/bin/node`, `/opt/homebrew/bin/node`…
3. Registra el servidor con el nombre **`asyncdv-docs`**: los comandos de `.claude/commands/` y los permisos de herramientas dependen de ese nombre.
4. Agrega las reglas de [instrucciones-ia.md](instrucciones-ia.md) al archivo de instrucciones de tu cliente.

En los ejemplos, reemplaza las rutas por las tuyas. La configuración va por `ASYNCDV_DOCS_CONFIG`; si prefieres no usar archivo, cambia esa variable por las `ASYNCDV_DOCS_*` que necesites.

> **Nunca apruebes `cambio_aplicar` de forma automática.** Es la única herramienta que escribe en tu vault: deja que el cliente te pregunte cada vez. Las demás son de solo lectura o solo preparan cambios.

## Claude Code

```bash
claude mcp add asyncdv-docs --scope user -e ASYNCDV_DOCS_CONFIG=/Users/tu-usuario/.config/asyncdv-docs/config.json -- /usr/local/bin/node /Users/tu-usuario/dev/obsidian-docs-mcp/src/index.ts
```

En Windows, desde PowerShell, usa `claude.cmd` (PowerShell se come el `--` de `claude`):

```powershell
claude.cmd mcp add asyncdv-docs --scope user -e "ASYNCDV_DOCS_CONFIG=C:\Users\tu-usuario\AppData\Roaming\asyncdv-docs-mcp\config.json" -- "C:\Program Files\nodejs\node.exe" "C:\Users\tu-usuario\dev\obsidian-docs-mcp\src\index.ts"
```

- `--scope user`: en todos tus proyectos. `--scope local` (por defecto): solo en la carpeta actual. `--scope project`: se guarda en `.mcp.json` para compartirlo con tu equipo (no pongas rutas personales ahí).
- Comprueba con `claude mcp list` y, dentro de una sesión, con `/mcp`.
- Copia `.claude/commands/` de este repo a `~/.claude/commands/` (o al `.claude/commands/` de tu proyecto) para tener `/tarea-nueva`, `/estado`, `/tablero`, `/pendientes`, `/funcionalidad`, `/documentar` y `/release`.

## Claude Desktop

Abre *Configuración → Desarrollador → Editar configuración*, que abre `claude_desktop_config.json`:

- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "asyncdv-docs": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": ["C:\\Users\\tu-usuario\\dev\\obsidian-docs-mcp\\src\\index.ts"],
      "env": { "ASYNCDV_DOCS_CONFIG": "C:\\Users\\tu-usuario\\AppData\\Roaming\\asyncdv-docs-mcp\\config.json" }
    }
  }
}
```

En JSON, cada `\` de una ruta de Windows se escribe `\\`. Reinicia Claude Desktop después de guardar.

## Cursor

Global: `~/.cursor/mcp.json`. Solo un proyecto: `.cursor/mcp.json`.

```json
{
  "mcpServers": {
    "asyncdv-docs": {
      "command": "/usr/local/bin/node",
      "args": ["/Users/tu-usuario/dev/obsidian-docs-mcp/src/index.ts"],
      "env": { "ASYNCDV_DOCS_CONFIG": "/Users/tu-usuario/.config/asyncdv-docs/config.json" }
    }
  }
}
```

Reglas: `.cursor/rules/asyncdv-docs.mdc`.

## VS Code (GitHub Copilot, modo agente)

Workspace: `.vscode/mcp.json`. Para todos tus proyectos: comando *MCP: Open User Configuration*. Ojo: aquí la clave es `servers`, no `mcpServers`.

```json
{
  "servers": {
    "asyncdv-docs": {
      "type": "stdio",
      "command": "/usr/local/bin/node",
      "args": ["/Users/tu-usuario/dev/obsidian-docs-mcp/src/index.ts"],
      "env": { "ASYNCDV_DOCS_CONFIG": "/Users/tu-usuario/.config/asyncdv-docs/config.json" }
    }
  }
}
```

Reglas: `.github/copilot-instructions.md`.

## Windsurf

`~/.codeium/windsurf/mcp_config.json`, con el mismo formato `mcpServers` que Cursor.

## Codex CLI

`~/.codex/config.toml`:

```toml
[mcp_servers.asyncdv-docs]
command = "/usr/local/bin/node"
args = ["/Users/tu-usuario/dev/obsidian-docs-mcp/src/index.ts"]
env = { ASYNCDV_DOCS_CONFIG = "/Users/tu-usuario/.config/asyncdv-docs/config.json" }
```

En Windows, usa comillas simples de TOML para no tener que duplicar las `\`:

```toml
[mcp_servers.asyncdv-docs]
command = 'C:\Program Files\nodejs\node.exe'
args = ['C:\Users\tu-usuario\dev\obsidian-docs-mcp\src\index.ts']
env = { ASYNCDV_DOCS_CONFIG = 'C:\Users\tu-usuario\AppData\Roaming\asyncdv-docs-mcp\config.json' }
```

Reglas: `AGENTS.md`.

## Gemini CLI

Global: `~/.gemini/settings.json`. Solo un proyecto: `.gemini/settings.json`.

```json
{
  "mcpServers": {
    "asyncdv-docs": {
      "command": "/usr/local/bin/node",
      "args": ["/Users/tu-usuario/dev/obsidian-docs-mcp/src/index.ts"],
      "env": { "ASYNCDV_DOCS_CONFIG": "/Users/tu-usuario/.config/asyncdv-docs/config.json" }
    }
  }
}
```

No uses `"trust": true`: haría que `cambio_aplicar` corra sin preguntarte. Reglas: `GEMINI.md`.

## Otros clientes

Cualquier cliente MCP con transporte stdio sirve (Cline, Roo Code, Zed, Continue…): busca en su documentación dónde van `command`, `args` y `env`, y usa los mismos valores.

## Opcional: endurecer con el modelo de permisos de Node

Node puede limitar qué lee y escribe el proceso. Si algo queda fuera, el servidor falla con `ERR_ACCESS_DENIED` en vez de tocarlo. Agrega estos argumentos **antes** de la ruta de `src/index.ts`:

```text
--permission
--allow-fs-read=<carpeta de obsidian-docs-mcp>
--allow-fs-read=<repo_path>
--allow-fs-read=<vault_path>/<project_dir>
--allow-fs-write=<vault_path>/<project_dir>
--allow-fs-read=<carpeta de config.json y de estado>
--allow-fs-write=<carpeta de estado>
--allow-fs-read=<git_path>
--allow-fs-read=<plantillas_dir>        (solo si la usas)
--allow-child-process                    (para git)
```

Ejemplo en JSON (macOS):

```json
"args": [
  "--permission",
  "--allow-fs-read=/Users/tu-usuario/dev/obsidian-docs-mcp",
  "--allow-fs-read=/Users/tu-usuario/dev/mi-app",
  "--allow-fs-read=/Users/tu-usuario/Obsidian/Vault/Proyectos/mi-app",
  "--allow-fs-write=/Users/tu-usuario/Obsidian/Vault/Proyectos/mi-app",
  "--allow-fs-read=/Users/tu-usuario/.config/asyncdv-docs",
  "--allow-fs-write=/Users/tu-usuario/.config/asyncdv-docs",
  "--allow-fs-read=/usr/bin/git",
  "--allow-child-process",
  "/Users/tu-usuario/dev/obsidian-docs-mcp/src/index.ts"
]
```

`proyecto_estado` informa si los permisos de Node están activos. `pnpm run iniciar` crea carpetas en el vault: córrelo sin `--permission`.
