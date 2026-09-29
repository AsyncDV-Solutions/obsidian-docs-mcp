import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { ErrorMcp } from './errores.ts';

// En Windows y macOS el sistema de archivos no distingue mayúsculas de minúsculas (por defecto); en Linux, sí.
const SIN_MAYUSCULAS = process.platform === 'win32' || process.platform === 'darwin';

// ¿Las dos rutas nombran lo mismo en este sistema?
export function mismaRuta(a: string, b: string): boolean {
  return SIN_MAYUSCULAS ? a.toLowerCase() === b.toLowerCase() : a === b;
}

// ¿"hijo" es "padre" o está dentro de él? Ambas deben ser rutas reales.
// En Windows, path.relative no distingue mayúsculas de minúsculas.
export function contiene(padre: string, hijo: string): boolean {
  const relativa = path.relative(padre, hijo);
  if (relativa === '') return true;
  return relativa !== '..' && !relativa.startsWith(`..${path.sep}`) && !path.isAbsolute(relativa);
}

// Ruta real de una carpeta o un archivo existente. Exige que no pase por ningún enlace
// (symlink o junction) ni use un nombre corto de Windows (8.3, como PROYEC~1).
export async function rutaCanonica(ruta: string, nombre: string): Promise<string> {
  const esperada = path.resolve(ruta);
  let real: string;
  try {
    real = await realpath(esperada);
  } catch {
    throw new ErrorMcp('RUTA_NO_EXISTE', `${nombre} no existe o no se puede leer.`);
  }
  if (!mismaRuta(real, esperada)) {
    throw new ErrorMcp('RUTA_ENLACE', `${nombre} pasa por un enlace (symlink o junction) o usa un nombre corto: usa la ruta real.`);
  }
  return real;
}
