import type { FileHandle } from 'node:fs/promises';
import { open, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { LETRA } from './dominio.ts';
import type { TipoNumerado } from './dominio.ts';
import { ErrorMcp } from './errores.ts';
import type { Nota } from './notas.ts';

export const RUTA_CONTADORES = '_contadores.md';

export function claveContador(tipo: TipoNumerado): string {
  return `ultimo_${LETRA[tipo]}`;
}

// Siguiente número: nunca menor que el contador guardado ni que el mayor ID existente.
// Así ningún número se reutiliza, aunque borres a mano la última nota.
export function siguienteNumero(tipo: TipoNumerado, prefijo: string, contadores: Record<string, unknown>, notas: Nota[]): number {
  const guardado = contadores[claveContador(tipo)];
  const patron = new RegExp(`^${prefijo}-${LETRA[tipo]}-(\\d{4,})$`);
  let mayor = 0;
  for (const n of notas) {
    const m = patron.exec(n.id);
    if (m !== null) mayor = Math.max(mayor, Number(m[1]));
  }
  return Math.max(typeof guardado === 'number' ? guardado : 0, mayor) + 1;
}

export function formatearId(prefijo: string, tipo: TipoNumerado, numero: number): string {
  return `${prefijo}-${LETRA[tipo]}-${String(numero).padStart(4, '0')}`;
}

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
