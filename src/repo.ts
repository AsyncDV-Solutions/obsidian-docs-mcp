import type { Dirent } from 'node:fs';
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { Contexto } from './arranque.ts';
import type { Categoria } from './config.ts';
import { ErrorMcp } from './errores.ts';
import { contiene, mismaRuta } from './rutas.ts';

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

// Divergencia entre la rama principal y la de desarrollo (release.rama_desarrollo).
// -1: esa rama no está en el clon local, o git no pudo contarla.
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
      return await ctx.consultasGit.contarCommitsEntre(desde, hasta);
    } catch (error) {
      if (error instanceof ErrorMcp && error.codigo === 'GIT') return -1; // la rama no está en el clon, o git falló
      throw error;
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
  const git = ctx.consultasGit;
  return {
    rama: await git.ramaActual(),
    head: await git.resolver('HEAD'),
    cambios: await git.cambiosSinCommit(),
    divergencia: await divergencia(ctx),
    recientes: await git.commitsRecientes(15),
    tags: await git.tagsDeVersion(),
  };
}
