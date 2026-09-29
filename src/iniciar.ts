// Prepara la carpeta del proyecto en el vault: la crea con sus subcarpetas y las notas del sistema
// (_proyecto.md, _contadores.md y Tablero.md). Nunca sobrescribe: lo que ya existe queda igual.
// Lo ejecutas tú, no el modelo:  pnpm run iniciar [--config <ruta>]   (o con las variables ASYNCDV_DOCS_*)
import { access, constants, lstat, mkdir, open, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document } from 'yaml';
import { validarArranque } from './arranque.ts';
import { cargarConfig, esRutaAbsolutaLocal, leerRutaConfig, nombreProyecto, PREFIJO_ENTORNO, VARIABLE_CONFIG } from './config.ts';
import type { Config } from './config.ts';
import { ErrorMcp } from './errores.ts';
import { unirNota } from './frontmatter.ts';
import { RUTA_CONTADORES } from './ids.ts';
import { contiene, mismaRuta, rutaCanonica } from './rutas.ts';
import { RUTA_TABLERO } from './tablero.ts';

export type Inicio = { creadas: string[]; existentes: string[]; avisos: string[] };

// Crea base/segmento/segmento… de a un nivel, sin pasar nunca por un enlace: un symlink o una junction
// en el camino podría llevar la creación fuera del vault.
async function crearCarpetaSegura(base: string, segmentos: string[], inicio: Inicio, etiqueta: string): Promise<string> {
  let actual = base;
  for (const segmento of segmentos) {
    actual = path.join(actual, segmento);
    const info = await lstat(actual).catch(() => null);
    if (info === null) {
      await mkdir(actual);
      inicio.creadas.push(`${path.relative(base, actual).split(path.sep).join('/')}/`);
    } else if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new ErrorMcp('RUTA_ENLACE', `${path.relative(base, actual)} existe y no es una carpeta normal (¿es un enlace?).`);
    }
  }
  const real = await rutaCanonica(actual, etiqueta);
  if (!contiene(base, real)) throw new ErrorMcp('RUTA_ENLACE', `${etiqueta} sale de la carpeta esperada.`);
  return real;
}

// Crea la nota solo si no existe ("wx" falla si ya está).
async function crearNota(proyecto: string, relativa: string, contenido: string, inicio: Inicio): Promise<void> {
  try {
    const fh = await open(path.join(proyecto, relativa), 'wx');
    try {
      await fh.writeFile(contenido, 'utf8');
    } finally {
      await fh.close();
    }
    inicio.creadas.push(relativa);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    inicio.existentes.push(relativa);
  }
}

function nota(propiedades: Record<string, unknown>, cuerpo: string): string {
  return unirNota({ bom: false, eol: '\n', doc: new Document(propiedades), cuerpo });
}

export async function iniciarProyecto(config: Config): Promise<Inicio> {
  const inicio: Inicio = { creadas: [], existentes: [], avisos: [] };
  const vault = await rutaCanonica(config.vault_path, 'vault_path'); // el vault no se crea: debe existir
  if ((await stat(path.join(vault, '.obsidian')).catch(() => null)) === null) {
    inicio.avisos.push('vault_path no tiene la carpeta .obsidian: ¿es la raíz de tu vault? Ábrelo una vez con Obsidian.');
  }
  const proyecto = await crearCarpetaSegura(vault, config.project_dir.split('/'), inicio, config.project_dir);
  if (mismaRuta(proyecto, vault)) throw new ErrorMcp('PROYECTO_FUERA', 'project_dir debe ser una subcarpeta del vault.');
  for (const carpeta of Object.values(config.carpetas)) await crearCarpetaSegura(proyecto, carpeta.split('/'), inicio, carpeta);

  const nombre = nombreProyecto(config);
  const base = { project_id: config.project_id };
  await crearNota(
    proyecto,
    '_proyecto.md',
    nota(
      { ...base, type: 'proyecto', id_prefix: config.id_prefix, schema: 1, title: nombre },
      `Marcador del proyecto ${nombre} para asyncdv-docs. No lo borres ni cambies su project_id: el MCP lo usa para comprobar que escribe en la carpeta correcta.\n`,
    ),
    inicio,
  );
  await crearNota(
    proyecto,
    RUTA_CONTADORES,
    nota(
      { ...base, type: 'contadores', schema: 1, title: 'Contadores', ultimo_T: 0, ultimo_F: 0, ultimo_I: 0, ultimo_ADR: 0, ultimo_G: 0 },
      'Último número usado por cada tipo de nota. Lo actualiza el MCP al crear notas: no lo edites a mano.\n',
    ),
    inicio,
  );
  await crearNota(
    proyecto,
    RUTA_TABLERO,
    nota(
      { ...base, type: 'referencia', schema: 1, title: 'Tablero' },
      `Tareas e incidencias de ${nombre}. El bloque de abajo lo regenera el MCP (tablero_regenerar): escribe fuera de él.\n\n%% asyncdv:inicio tablero %%\n%% asyncdv:fin %%\n`,
    ),
    inicio,
  );
  return inicio;
}

// Busca git en el PATH sin lanzar procesos: solo para sugerir git_path.
export async function buscarGit(entorno: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  const nombre = process.platform === 'win32' ? 'git.exe' : 'git';
  for (const carpeta of (entorno.PATH ?? entorno.Path ?? '').split(path.delimiter)) {
    if (!esRutaAbsolutaLocal(carpeta)) continue;
    const candidato = path.join(carpeta, nombre);
    try {
      await access(candidato, constants.X_OK);
      if ((await stat(candidato)).isFile()) return candidato;
    } catch {
      // no está en esta carpeta
    }
  }
  return null;
}

async function principal(): Promise<number> {
  const args = process.argv.slice(2);
  let config: Config;
  let rutaConfig: string | null;
  try {
    ({ config, rutaConfig } = await cargarConfig(leerRutaConfig(args, process.env), process.env));
  } catch (error) {
    console.error(error instanceof ErrorMcp ? `[${error.codigo}] ${error.message}` : String(error));
    console.error(`\nCopia ejemplos/config.ejemplo.json, ajústalo y ejecuta:  pnpm run iniciar --config <ruta del config.json>`);
    return 1;
  }

  console.log(`Preparando ${nombreProyecto(config)} en ${path.join(config.vault_path, ...config.project_dir.split('/'))}…`);
  let inicio: Inicio;
  try {
    inicio = await iniciarProyecto(config);
  } catch (error) {
    console.error(error instanceof ErrorMcp ? `[${error.codigo}] ${error.message}` : String(error));
    return 1;
  }
  for (const r of inicio.creadas) console.log(`  + ${r}`);
  for (const r of inicio.existentes) console.log(`  = ${r} (ya existía: no se tocó)`);
  for (const a of inicio.avisos) console.log(`  ! ${a}`);

  if (config.git_path === undefined) {
    const git = await buscarGit();
    console.log(
      git === null
        ? '\nFalta git_path: sin él, las herramientas del repo quedan bloqueadas. Instala git y agrega su ruta absoluta.'
        : `\nFalta git_path: sin él, las herramientas del repo quedan bloqueadas. Encontré git en:\n  ${git}\nAgrégalo como "git_path" o ${PREFIJO_ENTORNO}GIT_PATH.`,
    );
  }

  const estado = await validarArranque(args, process.env);
  if (!estado.ok) {
    console.log('\nEl servidor todavía no arrancaría:');
    for (const p of estado.problemas) console.log(`  - [${p.codigo}] ${p.mensaje}`);
    return 1;
  }

  // El cliente de IA debe recibir la misma configuración: el archivo y las variables ASYNCDV_DOCS_* de esta terminal.
  const servidor = fileURLToPath(new URL('./index.ts', import.meta.url));
  const env: Record<string, string> = {};
  for (const [clave, valor] of Object.entries(process.env)) {
    if (clave.startsWith(PREFIJO_ENTORNO) && valor !== undefined && valor !== '') env[clave] = valor;
  }
  if (rutaConfig !== null) env[VARIABLE_CONFIG] = rutaConfig;
  const comillas = (a: string): string => (/[\s"]/.test(a) ? `"${a}"` : a);
  console.log('\nConfiguración OK. Registra el servidor en tu cliente de IA (ver docs/clientes-ia.md). Por ejemplo, en JSON:');
  console.log(JSON.stringify({ mcpServers: { 'asyncdv-docs': { command: process.execPath, args: [servidor], env } } }, null, 2));
  const variables = Object.entries(env).map(([clave, valor]) => `-e ${comillas(`${clave}=${valor}`)} `).join('');
  console.log(`\nO en Claude Code (en PowerShell, usa claude.cmd):\n  claude mcp add asyncdv-docs --scope user ${variables}-- ${comillas(process.execPath)} ${comillas(servidor)}`);
  return 0;
}

const esPrincipal = process.argv[1] !== undefined && mismaRuta(path.resolve(process.argv[1]), fileURLToPath(import.meta.url));
if (esPrincipal) process.exitCode = await principal();
