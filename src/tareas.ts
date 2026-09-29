import type { Contexto } from './arranque.ts';
import { crear, editar } from './cambios.ts';
import type { Preparado } from './cambios.ts';
import { agregarCriterio, criteriosPendientes, normalizar, problemasDeTransicion } from './dominio.ts';
import type { Estado, Resolucion } from './dominio.ts';
import { ErrorMcp } from './errores.ts';
import type { Guardia } from './guardia.ts';
import { enlacesA, notaVigente } from './notas.ts';
import type { Indice, Nota } from './notas.ts';

export type DatosTareaNueva = {
  titulo: string;
  descripcion: string;
  criterios: string[];
  prioridad: string;
  area?: string[];
  responsable?: string;
  due?: string;
  release?: string;
  blocked_by?: string[];
  relacionadas?: string[];
  fuentes?: string[];
  estado_inicial: 'Por hacer' | 'Pendiente';
  motivo?: string;
  pedido_por: string;
};

// Una tarea abierta con el mismo título (sin mayúsculas ni tildes) ya existe: no se duplica.
export function tareaRepetida(indice: Indice, titulo: string): Nota | undefined {
  const buscado = normalizar(titulo);
  return indice.notas.find((n) => n.tipo === 'tarea' && n.datos.status !== 'Completado' && normalizar(n.titulo) === buscado);
}

export async function prepararTareaNueva(ctx: Contexto, guardia: Guardia, indice: Indice, d: DatosTareaNueva): Promise<Preparado> {
  if (d.estado_inicial === 'Pendiente' && (d.motivo?.trim() ?? '') === '') {
    throw new ErrorMcp('TRANSICION', '«Pendiente» exige un motivo que diga qué evento o condición se espera.');
  }
  return crear(ctx, guardia, indice, {
    tipo: 'tarea',
    id: { numerar: 'tarea' },
    carpeta: ctx.config.carpetas.tareas,
    titulo: d.titulo,
    propiedades: {
      status: d.estado_inicial,
      priority: d.prioridad,
      area: d.area ?? [],
      assignee: d.responsable,
      due: d.due,
      release: d.release === undefined ? undefined : enlacesA(ctx, indice, [d.release])[0],
      blocked_by: enlacesA(ctx, indice, d.blocked_by),
      related: enlacesA(ctx, indice, d.relacionadas),
      source: d.fuentes ?? [],
    },
    valores: {
      descripcion: d.descripcion,
      criterios: d.criterios.map((c) => `- [ ] ${c}`).join('\n'),
    },
    historial: `creada en «${d.estado_inicial}» · pidió: ${d.pedido_por}${d.motivo ? ` · motivo: ${d.motivo}` : ''}`,
    herramienta: 'tarea_crear',
  });
}


function tareaVigente(indice: Indice, id: string, version: string): Nota {
  return notaVigente(indice, id, version, ['tarea', 'incidencia'], 'la tarea o incidencia');
}

export type DatosCambioEstado = {
  id: string;
  estado: Estado;
  version_esperada: string;
  pedido_por: string;
  motivo?: string;
  resolution?: Resolucion;
  blocked_by?: string[];
  blocked_reason?: string;
};

// Devuelve null si la tarea ya está en ese estado: repetir no cambia nada ni agrega historial.
export async function prepararCambioEstado(ctx: Contexto, guardia: Guardia, indice: Indice, d: DatosCambioEstado): Promise<Preparado | null> {
  const nota = tareaVigente(indice, d.id, d.version_esperada);
  const origen = String(nota.datos.status ?? '');
  if (origen === d.estado) return null;
  const problemas = problemasDeTransicion(
    origen,
    { destino: d.estado, motivo: d.motivo, resolution: d.resolution, blocked_by: d.blocked_by, blocked_reason: d.blocked_reason },
    criteriosPendientes(nota.cuerpo),
  );
  if (problemas.length > 0) throw new ErrorMcp('TRANSICION', problemas.join(' '));
  const bloqueadaPor = enlacesA(ctx, indice, d.blocked_by);
  const detalles = [`pidió: ${d.pedido_por}`, d.motivo ? `motivo: ${d.motivo}` : '', d.resolution ? `resolution: ${d.resolution}` : '']
    .filter((x) => x !== '')
    .join(' · ');

  const propiedades: [string, unknown][] = [['status', d.estado]];
  if (d.estado === 'Bloqueado') {
    if (bloqueadaPor.length > 0) propiedades.push(['blocked_by', bloqueadaPor]);
    if (d.blocked_reason) propiedades.push(['blocked_reason', d.blocked_reason]);
  }
  propiedades.push(['resolution', d.estado === 'Completado' ? d.resolution : null]); // reabrir quita la resolución anterior
  return editar(ctx, guardia, nota, { herramienta: 'tarea_cambiar_estado', historial: `${origen} → ${d.estado} · ${detalles}`, propiedades });
}

export type DatosActualizacion = {
  id: string;
  version_esperada: string;
  pedido_por: string;
  prioridad?: string;
  responsable?: string | null; // null = quitar el campo
  due?: string | null;
  release?: string | null;
  area?: string[];
  blocked_by?: string[];
  blocked_reason?: string | null;
  relacionadas?: string[];
  criterio_nuevo?: string;
};

export async function prepararActualizacion(ctx: Contexto, guardia: Guardia, indice: Indice, d: DatosActualizacion): Promise<Preparado> {
  const nota = tareaVigente(indice, d.id, d.version_esperada);
  // Lista cerrada: cada campo del pedido se traduce a una propiedad de la nota (null la quita).
  const propiedades: [string, unknown][] = [];
  if (d.prioridad !== undefined) propiedades.push(['priority', d.prioridad]);
  if (d.responsable !== undefined) propiedades.push(['assignee', d.responsable]);
  if (d.due !== undefined) propiedades.push(['due', d.due]);
  if (d.release !== undefined) propiedades.push(['release', d.release === null ? null : enlacesA(ctx, indice, [d.release])[0]]);
  if (d.area !== undefined) propiedades.push(['area', d.area]);
  if (d.blocked_by !== undefined) propiedades.push(['blocked_by', enlacesA(ctx, indice, d.blocked_by)]);
  if (d.blocked_reason !== undefined) propiedades.push(['blocked_reason', d.blocked_reason]);
  if (d.relacionadas !== undefined) propiedades.push(['related', enlacesA(ctx, indice, d.relacionadas)]);
  const criterio = d.criterio_nuevo;
  if (propiedades.length === 0 && criterio === undefined) throw new ErrorMcp('SIN_CAMBIOS', 'No indicaste ningún campo para actualizar.');
  const nombres = [...propiedades.map(([clave]) => clave), ...(criterio === undefined ? [] : ['criterio'])];
  return editar(ctx, guardia, nota, {
    herramienta: 'tarea_actualizar',
    historial: `actualizada: ${nombres.join(', ')} · pidió: ${d.pedido_por}`,
    propiedades,
    cuerpo: criterio === undefined ? undefined : (cuerpo, eol) => agregarCriterio(cuerpo, criterio, eol),
  });
}
