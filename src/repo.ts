import { execFile } from 'node:child_process';
import type { Dirent } from 'node:fs';
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Contexto } from './arranque.ts';
import type { Categoria } from './config.ts';
import { ErrorMcp } from './errores.ts';
import { contiene, mismaRuta } from './rutas.ts';

const ejecutarArchivo = promisify(execFile);

// Exclusiones fijas: GANAN siempre, aunque la ruta calce con una categoría. En config.json
// (repo.excluir) se suman las propias de cada repo.
const EXCLUIDOS_BASE: RegExp[] = [
  /(^|\/)\.env[^/]*$/i,
  /(^|\/)\.dev\.vars[^/]*$/i,
  /(^|\/)\.(npmrc|pypirc|netrc)$/i,
  /\.(pem|key|p12|pfx|jks|keystore)$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)[^/]*$/i,
  /(^|\/)node_modules(\/|$)/i,
  /(^|\/)dist(\/|$)/i,
  /(^|\/)\.git(\/|$)/i,
];

// Convierte un patrón de repo.excluir en una expresión regular (sin distinguir mayúsculas):
//   **/  cualquier número de carpetas · /** al final: la carpeta y todo lo que contiene
//   *    cualquier texto dentro de un segmento · ?  un carácter
const patrones = new Map<string, RegExp>();

export function patronARegex(patron: string): RegExp {
  const guardado = patrones.get(patron);
  if (guardado !== undefined) return guardado;
  let fuente = '';
  for (let i = 0; i < patron.length; i++) {
    const resto = patron.slice(i);
    if (resto.startsWith('**/')) {
      fuente += '(?:.*/)?';
      i += 2;
    } else if (resto === '/**') {
      fuente += '(?:/.*)?';
      i += 2;
    } else if (resto.startsWith('**')) {
      fuente += '.*';
      i += 1;
    } else if (resto.startsWith('*')) {
      fuente += '[^/]*';
    } else if (resto.startsWith('?')) {
      fuente += '[^/]';
    } else {
      fuente += resto.charAt(0).replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  const regex = new RegExp(`^${fuente}$`, 'i');
  patrones.set(patron, regex);
  return regex;
}

export function excluida(ctx: Contexto, relativa: string): boolean {
  return EXCLUIDOS_BASE.some((r) => r.test(relativa)) || ctx.config.repo.excluir.some((p) => patronARegex(p).test(relativa));
}

export function validarRelativaRepo(ruta: string): string {
  if (/^[A-Za-z]:/.test(ruta) || ruta.startsWith('/') || ruta.startsWith('\\')) {
    throw new ErrorMcp('RUTA_ABSOLUTA', 'Solo se aceptan rutas relativas a la raíz del repo.');
  }
  if (ruta.length === 0 || ruta.length > 260 || /[\x00-\x1f:*?"<>|]/.test(ruta)) {
    throw new ErrorMcp('RUTA_INVALIDA', 'Ruta del repo no válida.');
  }
  const segmentos = ruta.replaceAll('\\', '/').split('/');
  if (segmentos.some((s) => s === '' || s === '.' || s === '..' || /[. ]$/.test(s))) {
    throw new ErrorMcp('RUTA_INVALIDA', 'Ruta del repo no válida.');
  }
  return segmentos.join('/');
}

// Qué permite la lista de permitidos (repo.categorias) para una ruta: nada (null), solo listar o también leer.
export function permiso(ctx: Contexto, relativa: string): { categoria: Categoria; leer: boolean } | null {
  if (excluida(ctx, relativa)) return null;
  const extension = path.posix.extname(relativa).toLowerCase();
  for (const c of ctx.config.repo.categorias) {
    if (c.archivos.includes(relativa)) return { categoria: c, leer: true };
    const enCarpeta = c.carpetas.some((carpeta) => relativa.startsWith(`${carpeta}/`));
    if (enCarpeta && c.extensiones.includes(extension)) return { categoria: c, leer: c.leer_carpetas };
  }
  return null;
}

export async function leerArchivoRepo(ctx: Contexto, ruta: string): Promise<string> {
  const relativa = validarRelativaRepo(ruta);
  const p = permiso(ctx, relativa);
  if (p === null || !p.leer) {
    throw new ErrorMcp('REPO_NO_PERMITIDO', `${relativa} no está en una categoría que permita leer su contenido.`);
  }
  const esperada = path.join(ctx.repo, ...relativa.split('/'));
  let real: string;
  try {
    real = await realpath(esperada);
  } catch {
    throw new ErrorMcp('REPO_NO_EXISTE', `No existe ${relativa} en el repo.`);
  }
  if (!mismaRuta(real, esperada) || !contiene(ctx.repo, real)) {
    throw new ErrorMcp('RUTA_ENLACE', `${relativa} pasa por un enlace.`);
  }
  const info = await lstat(real);
  if (!info.isFile()) throw new ErrorMcp('RUTA_NO_ARCHIVO', `${relativa} no es un archivo.`);
  if (info.size > ctx.config.limites.repo_archivo_max_kb * 1024) {
    throw new ErrorMcp('REPO_GRANDE', `${relativa} supera los ${ctx.config.limites.repo_archivo_max_kb} KB.`);
  }
  return readFile(real, 'utf8');
}

// Solo nombres, dentro de las carpetas de cada categoría, sin seguir enlaces ni entrar en ocultos.
export async function inventario(ctx: Contexto): Promise<{ categoria: string; descripcion: string; rutas: string[] }[]> {
  const salida: { categoria: string; descripcion: string; rutas: string[] }[] = [];
  for (const c of ctx.config.repo.categorias) {
    const rutas: string[] = [];
    for (const archivo of c.archivos) {
      if (permiso(ctx, archivo) !== null && (await lstat(path.join(ctx.repo, ...archivo.split('/'))).catch(() => null))?.isFile()) {
        rutas.push(archivo);
      }
    }
    for (const carpeta of c.carpetas) await recorrer(ctx, carpeta, c, rutas);
    salida.push({ categoria: c.clave, descripcion: c.descripcion, rutas: rutas.sort() });
  }
  return salida;
}

async function recorrer(ctx: Contexto, relativa: string, c: Categoria, rutas: string[]): Promise<void> {
  let entradas: Dirent[];
  try {
    entradas = await readdir(path.join(ctx.repo, ...relativa.split('/')), { withFileTypes: true });
  } catch {
    return; // la carpeta no existe en este repo
  }
  for (const e of entradas) {
    if (rutas.length >= 2000) return;
    if (e.name.startsWith('.') || e.isSymbolicLink()) continue;
    const rel = `${relativa}/${e.name}`;
    if (excluida(ctx, rel)) continue;
    if (e.isDirectory()) await recorrer(ctx, rel, c, rutas);
    else if (e.isFile() && c.extensiones.includes(path.posix.extname(e.name).toLowerCase())) rutas.push(rel);
  }
}

// Referencias git aceptadas: letras, dígitos y . _ / -, sin ".." y sin empezar con "-".
const REF = /^(?!-)(?!.*\.\.)[A-Za-z0-9._/-]{1,100}$/;

export function validarRef(ref: string): string {
  if (!REF.test(ref)) throw new ErrorMcp('REF_INVALIDA', `Referencia git no válida: «${ref}».`);
  return ref;
}

// Entorno mínimo para git (Windows, macOS y Linux). No se heredan variables GIT_* que cambien su comportamiento.
function entornoGit(): Record<string, string> {
  const entorno: Record<string, string> = { GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' };
  for (const clave of ['SYSTEMROOT', 'USERPROFILE', 'HOME', 'HOMEDRIVE', 'HOMEPATH', 'PATH', 'TMPDIR']) {
    const valor = process.env[clave];
    if (valor !== undefined) entorno[clave] = valor;
  }
  return entorno;
}

// Si el error de execFile es una salida que el llamador declaró válida, devuelve su stdout; si no, null.
// Solo cuenta una salida declarada de un proceso que terminó solo y sin nada en stderr: git grep también
// termina con 1 cuando no pudo leer un objeto, y eso no es «sin coincidencias». Un proceso matado por el
// plazo o por una señal nunca cuenta, sea cual sea el código con el que termine.
export function salidaAceptada(error: unknown, salidasValidas: number[] = []): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const { code, signal, killed, stdout, stderr } = error as { code?: unknown; signal?: unknown; killed?: unknown; stdout?: unknown; stderr?: unknown };
  const terminoSolo = killed !== true && (signal === null || signal === undefined);
  const sinErrores = typeof stderr === 'string' ? stderr.trim() === '' : stderr === undefined || stderr === null;
  if (!terminoSolo || !sinErrores || typeof code !== 'number' || !salidasValidas.includes(code)) return null;
  return typeof stdout === 'string' ? stdout : '';
}

// git SIN shell, con protecciones fijas. Solo se llama con subcomandos de lectura.
// salidasValidas: códigos de salida que no son un fallo para ese subcomando, p. ej. [1] en git grep, que
// termina con 1 cuando no hay coincidencias (ver salidaAceptada).
export async function git(ctx: Contexto, args: string[], opciones: { salidasValidas?: number[] } = {}): Promise<string> {
  const gitPath = ctx.git; // el archivo real, resuelto al arrancar
  if (gitPath === null) throw new ErrorMcp('GIT_NO_CONFIGURADO', 'Falta git_path (o ASYNCDV_DOCS_GIT_PATH): la ruta absoluta de git.');
  const protecciones = ['-C', ctx.repo, '--no-pager', '--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'log.showSignature=false'];
  try {
    const { stdout } = await ejecutarArchivo(gitPath, [...protecciones, ...args], {
      encoding: 'utf8',
      timeout: ctx.config.limites.git_timeout_ms,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
      shell: false,
      env: entornoGit(),
    });
    return stdout;
  } catch (error) {
    const salida = salidaAceptada(error, opciones.salidasValidas);
    if (salida !== null) return salida;
    throw new ErrorMcp('GIT', `git ${args[0] ?? ''} falló o tardó demasiado.`);
  }
}

// Divergencia entre la rama principal y la de desarrollo (release.rama_desarrollo).
// -1: esa rama no está en el clon local.
export type Divergencia = { principal: string; desarrollo: string; principalNoEnDesarrollo: number; desarrolloNoEnPrincipal: number };

export type ResumenGit = {
  rama: string;
  head: string;
  cambios: number;
  divergencia: Divergencia | null; // null si no hay rama de desarrollo configurada
  recientes: string[];
  tags: string[];
};

export async function divergencia(ctx: Contexto): Promise<Divergencia | null> {
  const { rama_principal: principal, rama_desarrollo: desarrollo } = ctx.config.release;
  if (desarrollo === undefined) return null;
  const contar = async (desde: string, hasta: string): Promise<number> => {
    try {
      const salida = await git(ctx, ['log', '--format=%H', '--end-of-options', `${validarRef(desde)}..${validarRef(hasta)}`]);
      return salida.split('\n').filter((l) => l !== '').length;
    } catch {
      return -1;
    }
  };
  return {
    principal,
    desarrollo,
    principalNoEnDesarrollo: await contar(desarrollo, principal),
    desarrolloNoEnPrincipal: await contar(principal, desarrollo),
  };
}

export async function resumenGit(ctx: Contexto): Promise<ResumenGit> {
  return {
    rama: (await git(ctx, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim(),
    head: (await git(ctx, ['rev-parse', 'HEAD'])).trim(),
    cambios: (await git(ctx, ['status', '--porcelain=v1'])).split('\n').filter((l) => l.trim() !== '').length,
    divergencia: await divergencia(ctx),
    recientes: (await git(ctx, ['log', '-n', '15', '--format=%h %ad %s', '--date=short', '--end-of-options', 'HEAD'])).split('\n').filter((l) => l !== ''),
    tags: (await git(ctx, ['tag', '--list', 'v*'])).split('\n').filter((l) => l !== ''),
  };
}
