import type { Contexto } from './arranque.ts';
import { escribirBloque, leerBloque } from './bloques.ts';
import { diffLineas, guardarCambio } from './confirmaciones.ts';
import type { Cambio } from './confirmaciones.ts';
import { enlace } from './creacion.ts';
import type { Preparado } from './creacion.ts';
import { ahora, ESTADOS } from './dominio.ts';
import { ErrorMcp } from './errores.ts';
import { separarNota, unirNota } from './frontmatter.ts';
import type { Guardia, Leida } from './guardia.ts';
import { comoLista, ordenPorPrioridad } from './notas.ts';
import type { Indice, Nota } from './notas.ts';

export const RUTA_TABLERO = 'Tablero.md';

// Id al que apunta un enlace [[…/ID-slug|alias]] (o el texto tal cual, si no es un enlace).
function idDeEnlace(valor: string): string {
  const destino = /^\[\[([^|\]]+)/.exec(valor)?.[1];
  if (destino === undefined) return valor;
  const nombre = destino.split('/').at(-1) ?? '';
  return /^(?:[A-Z]{2,5}-(?:T|F|I|ADR|G)-\d{4,}|[A-Z]{2,5}-R-v\d+\.\d+\.\d+)/.exec(nombre)?.[0] ?? nombre;
}

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
  const cfg = ctx.config;
  let leida: Leida;
  try {
    leida = await guardia.leer(RUTA_TABLERO);
  } catch (error) {
    if (error instanceof ErrorMcp && error.codigo === 'NOTA_NO_EXISTE') {
      throw new ErrorMcp('TABLERO_FALTA', `Falta ${RUTA_TABLERO}: créalo con «pnpm run iniciar».`);
    }
    throw error;
  }
  const sep = separarNota(leida.texto, cfg.limites.yaml_max_kb * 1024);
  if (sep.datos.project_id !== cfg.project_id) throw new ErrorMcp('PROJECT_ID_AJENO', `${RUTA_TABLERO} no pertenece a este proyecto.`);
  const bloque = leerBloque(sep.cuerpo, 'tablero');
  if (bloque === null) throw new ErrorMcp('BLOQUE_FALTA', `${RUTA_TABLERO} no tiene el bloque «tablero».`);

  const nuevo = generarTablero(ctx, indice).replace(/\n/g, sep.eol);
  const igual = nuevo.replaceAll('\r\n', '\n') === bloque.contenido.replaceAll('\r\n', '\n');
  if (igual && !bloque.editadoAMano) return null;

  sep.doc.set('updated', ahora(cfg.zona_horaria).fechaHora);
  const cuerpo = escribirBloque(sep.cuerpo, 'tablero', nuevo, sep.eol);
  const contenido = unirNota({ bom: sep.bom, eol: sep.eol, doc: sep.doc, cuerpo });
  const cambio: Cambio = {
    descripcion: 'regenerar el tablero',
    operaciones: [{ tipo: 'reemplazar', ruta: RUTA_TABLERO, contenido, versionEsperada: leida.version }],
  };
  const { confirmacion, expira } = guardarCambio(cambio, cfg.limites.confirmacion_minutos);
  const aviso = bloque.editadoAMano ? 'ATENCIÓN: el bloque del tablero fue editado a mano; al aplicar se pierden esos cambios.\n' : '';
  return { cambio, confirmacion, expira, vistaPrevia: `${aviso}Cambios en ${RUTA_TABLERO}:\n${diffLineas(leida.texto, contenido)}` };
}
