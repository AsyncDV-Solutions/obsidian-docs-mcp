import type { Contexto } from './arranque.ts';
import { regenerarBloque } from './cambios.ts';
import type { Preparado } from './cambios.ts';
import { ESTADOS } from './dominio.ts';
import { ErrorMcp } from './errores.ts';
import type { Guardia } from './guardia.ts';
import { enlace, idDeEnlace } from './ids.ts';
import { comoLista, ordenPorPrioridad } from './notas.ts';
import type { Indice, Nota } from './notas.ts';

export const RUTA_TABLERO = 'Tablero.md';

// Contenido del bloque «tablero». No lleva fecha: así, regenerar un tablero igual no cambia nada.
export function generarTablero(ctx: Contexto, indice: Indice): string {
  const items = indice.notas.filter((n) => n.tipo === 'tarea' || n.tipo === 'incidencia').sort(ordenPorPrioridad);
  const porId = new Map(indice.notas.map((n) => [n.id, n] as const)); // "as const": un par [clave, valor], no un arreglo cualquiera
  const linea = (n: Nota): string => `- ${enlace(ctx, n.ruta, n.id)} · ${String(n.datos.priority ?? '—')} · ${n.titulo}`;
  const salida: string[] = [`_${items.length} ítems entre tareas e incidencias._`, ''];

  for (const estado of ESTADOS) {
    const grupo = items.filter((n) => n.datos.status === estado);
    salida.push(`### ${estado} (${grupo.length})`, ...grupo.map(linea), '');
  }

  const bloqueadas = items.filter((n) => n.datos.status === 'Bloqueado');
  salida.push('### Bloqueos', ...(bloqueadas.length === 0 ? ['- (ninguno)'] : []));
  for (const n of bloqueadas) {
    const dependencias = comoLista(n.datos.blocked_by)
      .map(idDeEnlace)
      .map((id) => `${id} (${String(porId.get(id)?.datos.status ?? 'no existe')})`);
    const motivo = typeof n.datos.blocked_reason === 'string' ? ` · motivo: ${n.datos.blocked_reason}` : '';
    salida.push(`- ${enlace(ctx, n.ruta, n.id)} · bloqueada por: ${dependencias.join(', ') || '—'}${motivo}`);
  }
  salida.push('', '### Por release');

  const porRelease = new Map<string, Nota[]>();
  for (const n of items) {
    const release = comoLista(n.datos.release).map(idDeEnlace)[0] ?? 'Sin release';
    porRelease.set(release, [...(porRelease.get(release) ?? []), n]);
  }
  for (const [release, grupo] of [...porRelease.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    salida.push(`#### ${release}`, ...grupo.map((n) => `${linea(n)} · ${String(n.datos.status)}`));
  }

  const urgentes = items.filter((n) => (n.datos.priority === 'P0' || n.datos.priority === 'P1') && n.datos.status !== 'Completado');
  salida.push('', '### P0 y P1 abiertas', ...(urgentes.length === 0 ? ['- (ninguna)'] : urgentes.map(linea)));
  return salida.join('\n');
}

// Prepara el reemplazo del bloque «tablero». Devuelve null si ya está al día.
export async function prepararTablero(ctx: Contexto, guardia: Guardia, indice: Indice): Promise<Preparado | null> {
  try {
    return await regenerarBloque(ctx, guardia, RUTA_TABLERO, 'tablero', generarTablero(ctx, indice));
  } catch (error) {
    if (error instanceof ErrorMcp && error.codigo === 'NOTA_NO_EXISTE') {
      throw new ErrorMcp('TABLERO_FALTA', `Falta ${RUTA_TABLERO}: créalo con «pnpm run iniciar».`);
    }
    throw error;
  }
}
