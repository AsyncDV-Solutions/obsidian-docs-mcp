import type { Document } from 'yaml';
import type { Contexto } from './arranque.ts';
import { escribirBloque, leerBloque } from './bloques.ts';
import { diffLineas, guardarCambio } from './confirmaciones.ts';
import type { Cambio } from './confirmaciones.ts';
import { enlacesA, prepararCreacion } from './creacion.ts';
import type { Preparado } from './creacion.ts';
import { agregarCriterio, ahora, criteriosPendientes, normalizar, problemasDeTransicion } from './dominio.ts';
import type { Estado, Resolucion } from './dominio.ts';
import { ErrorMcp } from './errores.ts';
import { separarNota, unirNota } from './frontmatter.ts';
import type { Guardia } from './guardia.ts';
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
  return prepararCreacion(ctx, guardia, indice, {
    tipo: 'tarea',
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

// Busca la nota y exige que siga en la versión que el modelo leyó (concurrencia optimista).
export function notaVigente(indice: Indice, id: string, version: string, tipos: readonly string[], nombre: string): Nota {
  const nota = indice.notas.find((n) => n.id === id && tipos.includes(n.tipo));
  if (nota === undefined) throw new ErrorMcp('NOTA_NO_EXISTE', `No existe ${nombre} ${id}.`);
  if (nota.version !== version) {
    throw new ErrorMcp('CONFLICTO', `${id} cambió desde que la leíste (versión actual ${nota.version}): vuelve a leerla.`);
  }
  return nota;
}

function tareaVigente(indice: Indice, id: string, version: string): Nota {
  return notaVigente(indice, id, version, ['tarea', 'incidencia'], 'la tarea o incidencia');
}

export type Edicion = {
  herramienta: string;
  historial: string; // texto de la línea que se agrega al historial
  editar: (doc: Document) => void; // cambia propiedades
  cuerpo?: (cuerpo: string, eol: string) => string; // cambia el cuerpo (criterios o bloques gestionados)
  avisos?: string[]; // líneas que encabezan la vista previa, p. ej. un bloque editado a mano que se va a pisar
};

// Prepara el reemplazo de una nota existente: propiedades, updated y una línea de historial.
export async function prepararEdicion(ctx: Contexto, guardia: Guardia, nota: Nota, e: Edicion): Promise<Preparado> {
  const cfg = ctx.config;
  const leida = await guardia.leer(nota.ruta);
  if (leida.version !== nota.version) throw new ErrorMcp('CONFLICTO', `${nota.id} cambió mientras se preparaba el cambio.`);
  const sep = separarNota(leida.texto, cfg.limites.yaml_max_kb * 1024);
  const momento = ahora(cfg.zona_horaria);
  e.editar(sep.doc);
  sep.doc.set('updated', momento.fechaHora);
  let cuerpo = e.cuerpo === undefined ? sep.cuerpo : e.cuerpo(sep.cuerpo, sep.eol);
  const bloque = leerBloque(cuerpo, 'historial');
  if (bloque === null) throw new ErrorMcp('BLOQUE_FALTA', `${nota.id} no tiene el bloque de historial.`);
  const linea = `- ${momento.legible} · ${e.historial} · ${e.herramienta}`;
  cuerpo = escribirBloque(cuerpo, 'historial', bloque.contenido === '' ? linea : `${bloque.contenido}${sep.eol}${linea}`, sep.eol);
  const contenido = unirNota({ bom: sep.bom, eol: sep.eol, doc: sep.doc, cuerpo });

  const cambio: Cambio = {
    descripcion: `editar ${nota.id}`,
    operaciones: [{ tipo: 'reemplazar', ruta: nota.ruta, contenido, versionEsperada: leida.version }],
  };
  const { confirmacion, expira } = guardarCambio(cambio, cfg.limites.confirmacion_minutos);
  const avisos = [...(e.avisos ?? [])];
  if (bloque.editadoAMano) avisos.push('Aviso: el historial fue editado a mano; se agrega la línea igual y se renueva su huella.');
  const aviso = avisos.map((a) => `${a}\n`).join('');
  return { cambio, confirmacion, expira, vistaPrevia: `${aviso}Cambios en ${nota.ruta}:\n${diffLineas(leida.texto, contenido)}` };
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
  return prepararEdicion(ctx, guardia, nota, {
    herramienta: 'tarea_cambiar_estado',
    historial: `${origen} → ${d.estado} · ${detalles}`,
    editar: (doc) => {
      doc.set('status', d.estado);
      if (d.estado === 'Bloqueado') {
        if (bloqueadaPor.length > 0) doc.set('blocked_by', bloqueadaPor);
        if (d.blocked_reason) doc.set('blocked_reason', d.blocked_reason);
      }
      if (d.estado === 'Completado') doc.set('resolution', d.resolution);
      else doc.delete('resolution'); // reabrir quita la resolución anterior
    },
  });
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
  // Lista cerrada: cada campo del pedido se traduce a una propiedad de la nota.
  const cambios: [string, unknown][] = [];
  if (d.prioridad !== undefined) cambios.push(['priority', d.prioridad]);
  if (d.responsable !== undefined) cambios.push(['assignee', d.responsable]);
  if (d.due !== undefined) cambios.push(['due', d.due]);
  if (d.release !== undefined) cambios.push(['release', d.release === null ? null : enlacesA(ctx, indice, [d.release])[0]]);
  if (d.area !== undefined) cambios.push(['area', d.area]);
  if (d.blocked_by !== undefined) cambios.push(['blocked_by', enlacesA(ctx, indice, d.blocked_by)]);
  if (d.blocked_reason !== undefined) cambios.push(['blocked_reason', d.blocked_reason]);
  if (d.relacionadas !== undefined) cambios.push(['related', enlacesA(ctx, indice, d.relacionadas)]);
  const criterio = d.criterio_nuevo;
  if (cambios.length === 0 && criterio === undefined) throw new ErrorMcp('SIN_CAMBIOS', 'No indicaste ningún campo para actualizar.');
  const nombres = [...cambios.map(([clave]) => clave), ...(criterio === undefined ? [] : ['criterio'])];
  return prepararEdicion(ctx, guardia, nota, {
    herramienta: 'tarea_actualizar',
    historial: `actualizada: ${nombres.join(', ')} · pidió: ${d.pedido_por}`,
    editar: (doc) => {
      for (const [clave, valor] of cambios) {
        if (valor === null) doc.delete(clave);
        else doc.set(clave, valor);
      }
    },
    cuerpo: criterio === undefined ? undefined : (cuerpo, eol) => agregarCriterio(cuerpo, criterio, eol),
  });
}
