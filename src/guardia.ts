import { createHash } from 'node:crypto';
import type { Stats } from 'node:fs';
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { ErrorMcp } from './errores.ts';
import { contiene, mismaRuta } from './rutas.ts';

// Nombres de dispositivo de Windows: "NUL.md" no es un archivo, es un dispositivo.
const RESERVADOS = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

export type Leida = { ruta: string; texto: string; version: string };

export type Guardia = {
  // Lee una nota existente del proyecto: su texto y su versión (hash de los bytes).
  leer(relativa: string): Promise<Leida>;
  // Valida dónde se puede escribir una nota (exista o no) y devuelve su ruta absoluta.
  rutaParaEscribir(relativa: string): Promise<string>;
  // Lista las notas .md del proyecto sin seguir enlaces ni entrar en carpetas ocultas.
  listar(): Promise<{ rutas: string[]; truncado: boolean }>;
};

// La versión de una nota es la huella de sus bytes, recortada: la entrega nota_leer y se exige para editar.
export const LARGO_VERSION = 16;

export function versionDe(contenido: Buffer | string): string {
  return createHash('sha256').update(contenido).digest('hex').slice(0, LARGO_VERSION);
}

// Valida una ruta relativa a la carpeta del proyecto y la devuelve normalizada con "/".
export function validarRelativa(relativa: string): string {
  if (relativa.length === 0 || relativa.length > 260 || /[\x00-\x1f]/.test(relativa)) {
    throw new ErrorMcp('RUTA_INVALIDA', 'Ruta vacía, demasiado larga o con caracteres de control.');
  }
  if (/^[A-Za-z]:/.test(relativa) || relativa.startsWith('/') || relativa.startsWith('\\')) {
    throw new ErrorMcp('RUTA_ABSOLUTA', 'Solo se aceptan rutas relativas a la carpeta del proyecto.');
  }
  const segmentos = relativa.replaceAll('\\', '/').split('/');
  for (const s of segmentos) {
    if (s === '.' || s === '..') throw new ErrorMcp('RUTA_SALE', 'La ruta no puede usar «.» ni «..».');
    // ":" abriría un flujo alternativo de NTFS (nota.md:secreto); un punto o un espacio al
    // final se ignoran en Windows y darían dos nombres para el mismo archivo.
    if (s === '' || /[:*?"<>|]/.test(s) || /[. ]$/.test(s)) {
      throw new ErrorMcp('RUTA_INVALIDA', `Segmento no válido en la ruta: «${s}».`);
    }
    if (s.startsWith('.')) throw new ErrorMcp('RUTA_OCULTA', 'La ruta no puede apuntar a archivos ni carpetas ocultos.');
    if (RESERVADOS.test(s)) throw new ErrorMcp('RUTA_RESERVADA', `«${s}» es un nombre reservado de Windows.`);
  }
  if (!(segmentos.at(-1) ?? '').toLowerCase().endsWith('.md')) {
    throw new ErrorMcp('RUTA_NO_MD', 'Solo se aceptan notas .md.');
  }
  return segmentos.join('/');
}

export function crearGuardia(proyecto: string, limites: { nota_max_kb: number; notas_max: number }): Guardia {
  const absoluta = (rel: string): string => path.join(proyecto, ...rel.split('/'));

  // Un archivo normal, real (sin enlaces en su camino), dentro del proyecto y con un solo nombre.
  async function archivoSeguro(rel: string): Promise<{ real: string; info: Stats }> {
    const esperada = absoluta(rel);
    let info: Stats;
    try {
      info = await lstat(esperada);
    } catch {
      throw new ErrorMcp('NOTA_NO_EXISTE', `No existe ${rel}.`);
    }
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new ErrorMcp('RUTA_ENLACE', `${rel} no es un archivo normal (¿es un enlace?).`);
    }
    const real = await realpath(esperada);
    if (!mismaRuta(real, esperada) || !contiene(proyecto, real)) {
      throw new ErrorMcp('RUTA_ENLACE', `${rel} pasa por un enlace o sale de la carpeta del proyecto.`);
    }
    if (info.nlink > 1) {
      throw new ErrorMcp('RUTA_ENLACE_DURO', `${rel} tiene más de un nombre en el disco (enlace duro).`);
    }
    return { real, info };
  }

  return {
    async leer(relativa) {
      const rel = validarRelativa(relativa);
      const { real, info } = await archivoSeguro(rel);
      if (info.size > limites.nota_max_kb * 1024) {
        throw new ErrorMcp('NOTA_GRANDE', `${rel} supera los ${limites.nota_max_kb} KB.`);
      }
      const bytes = await readFile(real);
      return { ruta: rel, texto: bytes.toString('utf8'), version: versionDe(bytes) };
    },

    async rutaParaEscribir(relativa) {
      const rel = validarRelativa(relativa);
      const esperada = absoluta(rel);
      const carpeta = path.dirname(esperada);
      let realCarpeta: string;
      try {
        realCarpeta = await realpath(carpeta);
      } catch {
        throw new ErrorMcp('CARPETA_NO_EXISTE', `No existe la carpeta de ${rel}: créala en Obsidian o con «pnpm run iniciar».`);
      }
      if (!mismaRuta(realCarpeta, carpeta) || !contiene(proyecto, realCarpeta)) {
        throw new ErrorMcp('RUTA_ENLACE', `La carpeta de ${rel} pasa por un enlace o sale del proyecto.`);
      }
      try {
        await archivoSeguro(rel); // si ya existe, debe ser un archivo normal
      } catch (error) {
        if (!(error instanceof ErrorMcp) || error.codigo !== 'NOTA_NO_EXISTE') throw error;
      }
      return esperada;
    },

    async listar() {
      const rutas: string[] = [];
      let truncado = false;
      const recorrer = async (carpeta: string, prefijo: string): Promise<void> => {
        const entradas = await readdir(carpeta, { withFileTypes: true });
        entradas.sort((a, b) => a.name.localeCompare(b.name));
        for (const e of entradas) {
          if (truncado) return;
          // Ocultos (incluye .obsidian y los temporales del MCP) y enlaces: fuera.
          if (e.name.startsWith('.') || e.isSymbolicLink()) continue;
          const rel = prefijo === '' ? e.name : `${prefijo}/${e.name}`;
          if (e.isDirectory()) {
            const sub = path.join(carpeta, e.name);
            // Segunda defensa: si la carpeta no es real (una junction), no se entra.
            if (!mismaRuta(await realpath(sub), sub)) continue;
            await recorrer(sub, rel);
          } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
            if (rutas.length >= limites.notas_max) {
              truncado = true;
              return;
            }
            rutas.push(rel);
          }
        }
      };
      await recorrer(proyecto, '');
      return { rutas, truncado };
    },
  };
}
