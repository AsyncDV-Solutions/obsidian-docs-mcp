import { randomBytes } from 'node:crypto';
import type { FileHandle } from 'node:fs/promises';
import { open, readFile, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as esperar } from 'node:timers/promises';
import { ErrorMcp } from './errores.ts';
import { versionDe } from './guardia.ts';

// Escribe todo y fuerza el paso a disco (fsync) antes de cerrar.
async function escribirYSincronizar(fh: FileHandle, contenido: string): Promise<void> {
  try {
    await fh.writeFile(contenido, 'utf8');
    await fh.sync();
  } finally {
    await fh.close();
  }
}

// Crea un archivo nuevo. La bandera "wx" falla si ya existe: nunca sobrescribe.
export async function crearExclusivo(absoluta: string, contenido: string): Promise<void> {
  let fh: FileHandle;
  try {
    fh = await open(absoluta, 'wx');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new ErrorMcp('YA_EXISTE', 'Ya existe una nota con ese nombre.');
    }
    throw error;
  }
  try {
    await escribirYSincronizar(fh, contenido);
  } catch (error) {
    await unlink(absoluta).catch(() => {}); // no dejar un archivo a medias
    throw error;
  }
}

const REINTENTABLES = new Set(['EPERM', 'EBUSY', 'EACCES']);

// Reemplazo atómico: temporal oculto en la misma carpeta + renombre. El archivo nunca queda a medias.
// Relee el original antes y después de escribir el temporal: si cambió, no escribe nada.
export async function reemplazarAtomico(absoluta: string, contenido: string, versionEsperada: string): Promise<void> {
  const verificar = async (): Promise<void> => {
    if (versionDe(await readFile(absoluta)) !== versionEsperada) {
      throw new ErrorMcp('CONFLICTO', 'La nota cambió desde la vista previa: vuelve a leerla y a preparar el cambio.');
    }
  };
  await verificar();
  const temporal = path.join(path.dirname(absoluta), `.${path.basename(absoluta)}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    await escribirYSincronizar(await open(temporal, 'wx'), contenido);
    await verificar(); // segunda lectura: acorta la ventana en la que tú podrías estar editando
    for (let intento = 1; ; intento++) {
      try {
        await rename(temporal, absoluta);
        return;
      } catch (error) {
        const codigo = (error as NodeJS.ErrnoException).code ?? '';
        if (!REINTENTABLES.has(codigo) || intento >= 5) throw error;
        await esperar(100 * intento); // en Windows, un antivirus o un indexador pueden tener el archivo abierto
      }
    }
  } catch (error) {
    await unlink(temporal).catch(() => {});
    if (error instanceof ErrorMcp) throw error;
    throw new ErrorMcp('ESCRITURA', 'No pude reemplazar la nota (¿está abierta o bloqueada?). No se cambió nada.');
  }
}

// Lo que toca el disco al aplicar un cambio, aparte para que una prueba ponga uno de mentira.
export type Escritor = { crearExclusivo: typeof crearExclusivo; reemplazarAtomico: typeof reemplazarAtomico };

export const escritorReal: Escritor = { crearExclusivo, reemplazarAtomico };

// Exclusión mutua entre procesos: un archivo de bloqueo en la carpeta de estado, fuera del vault.
// Si dos sesiones (del mismo u otro cliente de IA) aplican cambios a la vez, una recibe BLOQUEO_OCUPADO y reintenta.
export async function conBloqueo<T>(dirEstado: string, trabajo: () => Promise<T>): Promise<T> {
  const ruta = path.join(dirEstado, 'escritura.lock');
  let fh: FileHandle;
  try {
    fh = await open(ruta, 'wx');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const antiguedad = Date.now() - (await stat(ruta)).mtimeMs;
    if (antiguedad > 60_000) {
      throw new ErrorMcp(
        'BLOQUEO_ANTIGUO',
        'Hay un bloqueo de escritura de hace más de un minuto. Si no hay otra sesión escribiendo, borra escritura.lock de la carpeta de estado (state_dir).',
      );
    }
    throw new ErrorMcp('BLOQUEO_OCUPADO', 'Otra sesión está escribiendo. Reintenta en unos segundos.');
  }
  try {
    try {
      await fh.writeFile(`${process.pid} ${new Date().toISOString()}\n`, 'utf8');
    } finally {
      await fh.close();
    }
    return await trabajo();
  } finally {
    await unlink(ruta).catch(() => {});
  }
}
