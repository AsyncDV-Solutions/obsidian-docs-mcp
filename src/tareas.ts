import type { Sesion } from './sesion.ts';
import { clavesConValor, crear, editar } from './cambios.ts';
import type { Preparado, Propiedades } from './cambios.ts';
import { agregarCriterio, criteriosPendientes, limpiarTextoLibre, normalizar, problemasDeTransicion, quienPide } from './dominio.ts';
import type { Estado, Resolucion } from './dominio.ts';
import { ErrorMcp } from './errores.ts';
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
  pedido_por?: string | undefined;
};

// Una tarea abierta con el mismo título (sin mayúsculas ni tildes) ya existe: no se duplica.
function tareaRepetida(indice: Indice, titulo: string): Nota | undefined {
  const buscado = normalizar(titulo);
  return indice.notas.find((n) => n.tipo === 'tarea' && n.datos.status !== 'Completado' && normalizar(n.titulo) === buscado);
}

// En lugar de un cambio preparado, devuelve la tarea abierta que ya tiene ese título.
export type TareaRepetida = { repetida: Nota };

export async function prepararTareaNueva(sesion: Sesion, sinLimpiar: DatosTareaNueva): Promise<Preparado | TareaRepetida> {
  const datos = limpiarTextoLibre(sinLimpiar, sesion.config.limites.campo_max_kb);
  const pedidoPor = quienPide(sesion.config, datos.pedido_por);
  const indice = await sesion.indice();
  const repetida = tareaRepetida(indice, datos.titulo);
  if (repetida !== undefined) return { repetida };
  if (datos.estado_inicial === 'Pendiente' && (datos.motivo ?? '') === '') {
    throw new ErrorMcp('TRANSICION', '«Pendiente» exige un motivo que diga qué evento o condición se espera.');
  }
  return crear(sesion, indice, {
    tipo: 'tarea',
    titulo: datos.titulo,
    propiedades: {
      status: datos.estado_inicial,
      priority: datos.prioridad,
      area: datos.area ?? [],
      assignee: datos.responsable,
      due: datos.due,
      release: datos.release === undefined ? undefined : enlacesA(sesion.config.project_dir, indice, [datos.release])[0],
      blocked_by: enlacesA(sesion.config.project_dir, indice, datos.blocked_by),
      related: enlacesA(sesion.config.project_dir, indice, datos.relacionadas),
      source: datos.fuentes ?? [],
    },
    valores: {
      descripcion: datos.descripcion,
      criterios: datos.criterios.map((c) => `- [ ] ${c}`).join('\n'),
    },
    historial: `creada en «${datos.estado_inicial}» · pidió: ${pedidoPor}${datos.motivo ? ` · motivo: ${datos.motivo}` : ''}`,
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
  pedido_por?: string | undefined;
  motivo?: string;
  resolution?: Resolucion;
  blocked_by?: string[];
  blocked_reason?: string;
};

// Devuelve null si la tarea ya está en ese estado: repetir no cambia nada ni agrega historial.
export async function prepararCambioEstado(sesion: Sesion, sinLimpiar: DatosCambioEstado): Promise<Preparado | null> {
  const datos = limpiarTextoLibre(sinLimpiar, sesion.config.limites.campo_max_kb);
  const pedidoPor = quienPide(sesion.config, datos.pedido_por);
  const indice = await sesion.indice();
  const nota = tareaVigente(indice, datos.id, datos.version_esperada);
  const origen = String(nota.datos.status ?? '');
  if (origen === datos.estado) return null;
  const problemas = problemasDeTransicion(
    origen,
    { destino: datos.estado, motivo: datos.motivo, resolution: datos.resolution, blocked_by: datos.blocked_by, blocked_reason: datos.blocked_reason },
    criteriosPendientes(nota.cuerpo),
  );
  if (problemas.length > 0) throw new ErrorMcp('TRANSICION', problemas.join(' '));
  const bloqueadaPor = enlacesA(sesion.config.project_dir, indice, datos.blocked_by);
  const detalles = [`pidió: ${pedidoPor}`, datos.motivo ? `motivo: ${datos.motivo}` : '', datos.resolution ? `resolution: ${datos.resolution}` : '']
    .filter((x) => x !== '')
    .join(' · ');

  const bloqueado = datos.estado === 'Bloqueado';
  const propiedades: Propiedades = {
    status: datos.estado,
    blocked_by: bloqueado && bloqueadaPor.length > 0 ? bloqueadaPor : undefined,
    blocked_reason: bloqueado && datos.blocked_reason ? datos.blocked_reason : undefined,
    resolution: datos.estado === 'Completado' ? datos.resolution : null, // reabrir quita la resolución anterior
  };
  return editar(sesion, nota, { herramienta: 'tarea_cambiar_estado', historial: `${origen} → ${datos.estado} · ${detalles}`, propiedades });
}

export type DatosActualizacion = {
  id: string;
  version_esperada: string;
  pedido_por?: string | undefined;
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

export async function prepararActualizacion(sesion: Sesion, sinLimpiar: DatosActualizacion): Promise<Preparado> {
  const datos = limpiarTextoLibre(sinLimpiar, sesion.config.limites.campo_max_kb);
  const pedidoPor = quienPide(sesion.config, datos.pedido_por);
  const indice = await sesion.indice();
  const nota = tareaVigente(indice, datos.id, datos.version_esperada);
  // Lista cerrada: cada campo del pedido se traduce a una propiedad de la nota (null la quita).
  const enlaces = (ids: string[] | undefined): string[] | undefined => (ids === undefined ? undefined : enlacesA(sesion.config.project_dir, indice, ids));
  const propiedades: Propiedades = {
    priority: datos.prioridad,
    assignee: datos.responsable,
    due: datos.due,
    release: datos.release === null ? null : enlaces(datos.release === undefined ? undefined : [datos.release])?.[0],
    area: datos.area,
    blocked_by: enlaces(datos.blocked_by),
    blocked_reason: datos.blocked_reason,
    related: enlaces(datos.relacionadas),
  };
  const criterio = datos.criterio_nuevo;
  const nombres = [...clavesConValor(propiedades), ...(criterio === undefined ? [] : ['criterio'])];
  if (nombres.length === 0) throw new ErrorMcp('SIN_CAMBIOS', 'No indicaste ningún campo para actualizar.');
  return editar(sesion, nota, {
    herramienta: 'tarea_actualizar',
    historial: `actualizada: ${nombres.join(', ')} · pidió: ${pedidoPor}`,
    propiedades,
    cuerpo: criterio === undefined ? undefined : (cuerpo, eol) => agregarCriterio(cuerpo, criterio, eol),
  });
}
