import type { Contexto } from './arranque.ts';
import { escribirBloque, leerBloque } from './bloques.ts';
import { enlacesA, prepararCreacion } from './creacion.ts';
import type { Preparado } from './creacion.ts';
import { ahora } from './dominio.ts';
import { ErrorMcp } from './errores.ts';
import type { Guardia } from './guardia.ts';
import type { Indice } from './notas.ts';
import { notaVigente, prepararEdicion } from './tareas.ts';

// Una celda de tabla Markdown no puede tener "|" (partiría la columna) ni saltos de línea.
function celda(texto: string): string {
  return texto.replaceAll('|', '\\|').replace(/\r?\n/g, ' ');
}

export type Afirmacion = { afirmacion: string; evidencia: string; fuente: string };

function filasAfirmaciones(afirmaciones: Afirmacion[]): string {
  return afirmaciones.map((a) => `| ${celda(a.afirmacion)} | ${a.evidencia} | ${celda(a.fuente)} |`).join('\n');
}

// La key es única entre funcionalidades y guías: una misma cosa se documenta una sola vez.
function exigirKeyLibre(indice: Indice, key: string): void {
  const repetida = indice.notas.find((n) => (n.tipo === 'funcionalidad' || n.tipo === 'guia') && n.datos.key === key);
  if (repetida !== undefined) throw new ErrorMcp('KEY_REPETIDA', `Ya existe ${repetida.id} con la key ${key}.`);
}

export type DatosFuncionalidad = {
  key: string;
  titulo: string;
  que_hace: string;
  afirmaciones: Afirmacion[];
  evidence: string;
  reviewed_commit: string;
  fuentes: string[];
  area?: string[];
  relacionadas?: string[];
  pendientes?: string[];
};

// ——— Versión 1.2.0: el contenido de una funcionalidad vive en bloques gestionados ———

// La tabla completa, con su encabezado: los marcadores no pueden quedar entre el encabezado y las filas.
function tablaAfirmaciones(afirmaciones: Afirmacion[]): string {
  return ['| Afirmación | Evidencia | Fuente |', '|---|---|---|', filasAfirmaciones(afirmaciones)].join('\n');
}

function listaPendientes(ctx: Contexto, indice: Indice, ids: string[] | undefined): string {
  const enlaces = enlacesA(ctx, indice, ids);
  return enlaces.length === 0 ? '(ninguno)' : enlaces.map((e) => `- ${e}`).join('\n');
}

// Una línea en blanco antes y después del contenido: en Markdown, una tabla pegada a un marcador
// no se dibuja, y la línea pegada debajo de una tabla se vuelve otra fila.
function envolver(texto: string): string {
  return `\n${texto}\n`;
}

// Bloques que funcionalidad_actualizar puede reescribir, en el orden en que aparecen en la nota.
const BLOQUES_FUNCIONALIDAD = ['que_hace', 'afirmaciones', 'pendientes'] as const;
type BloqueFuncionalidad = (typeof BLOQUES_FUNCIONALIDAD)[number];

export async function prepararFuncionalidad(ctx: Contexto, guardia: Guardia, indice: Indice, d: DatosFuncionalidad): Promise<Preparado> {
  exigirKeyLibre(indice, d.key);
  return prepararCreacion(ctx, guardia, indice, {
    tipo: 'funcionalidad',
    carpeta: ctx.config.carpetas.funcionalidades,
    titulo: d.titulo,
    propiedades: {
      key: d.key,
      area: d.area ?? [],
      evidence: d.evidence,
      reviewed_commit: d.reviewed_commit,
      reviewed_on: ahora(ctx.config.zona_horaria).fecha,
      source: d.fuentes,
      related: enlacesA(ctx, indice, d.relacionadas),
    },
    valores: {},
    bloques: {
      que_hace: envolver(d.que_hace),
      afirmaciones: envolver(tablaAfirmaciones(d.afirmaciones)),
      pendientes: envolver(listaPendientes(ctx, indice, d.pendientes)),
    },
    historial: `creada · revisada en ${d.reviewed_commit}`,
    herramienta: 'funcionalidad_crear',
  });
}

export type DatosActualizacionFuncionalidad = {
  id: string;
  version_esperada: string;
  pedido_por: string;
  motivo?: string;
  titulo?: string;
  que_hace?: string;
  afirmaciones?: Afirmacion[];
  evidence?: string;
  reviewed_commit?: string;
  fuentes?: string[];
  area?: string[];
  relacionadas?: string[];
  pendientes?: string[];
};

// Edita una funcionalidad existente. La key no cambia: es su identidad natural.
// Solo reescribe propiedades de una lista cerrada y los bloques gestionados; «Notas» y todo lo
// que esté fuera de los bloques queda igual, byte a byte.
export async function prepararActualizacionFuncionalidad(
  ctx: Contexto,
  guardia: Guardia,
  indice: Indice,
  d: DatosActualizacionFuncionalidad,
): Promise<Preparado> {
  const nota = notaVigente(indice, d.id, d.version_esperada, ['funcionalidad'], 'la funcionalidad');
  // Afirmaciones, fuentes y evidencia son una revisión nueva: sin el SHA revisado no se sabe contra qué código valen.
  if ((d.afirmaciones !== undefined || d.fuentes !== undefined || d.evidence !== undefined) && d.reviewed_commit === undefined) {
    throw new ErrorMcp('FALTA_COMMIT', 'Cambiar afirmaciones, fuentes o evidence exige reviewed_commit: el SHA contra el que revisaste.');
  }

  const propiedades: [string, unknown][] = [];
  if (d.titulo !== undefined) propiedades.push(['title', d.titulo]); // el nombre del archivo no cambia
  if (d.area !== undefined) propiedades.push(['area', d.area]);
  if (d.evidence !== undefined) propiedades.push(['evidence', d.evidence]);
  if (d.reviewed_commit !== undefined) {
    propiedades.push(['reviewed_commit', d.reviewed_commit], ['reviewed_on', ahora(ctx.config.zona_horaria).fecha]);
  }
  if (d.fuentes !== undefined) propiedades.push(['source', d.fuentes]);
  if (d.relacionadas !== undefined) propiedades.push(['related', enlacesA(ctx, indice, d.relacionadas)]);

  const bloques = new Map<BloqueFuncionalidad, string>();
  if (d.que_hace !== undefined) bloques.set('que_hace', d.que_hace);
  if (d.afirmaciones !== undefined) bloques.set('afirmaciones', tablaAfirmaciones(d.afirmaciones));
  if (d.pendientes !== undefined) bloques.set('pendientes', listaPendientes(ctx, indice, d.pendientes));
  if (propiedades.length === 0 && bloques.size === 0) throw new ErrorMcp('SIN_CAMBIOS', 'No indicaste ningún campo para actualizar.');

  // Antes de preparar: cada bloque pedido debe existir, y lo editado a mano se advierte (se va a pisar).
  const avisos: string[] = [];
  for (const nombre of bloques.keys()) {
    const bloque = leerBloque(nota.cuerpo, nombre);
    if (bloque === null) {
      throw new ErrorMcp(
        'BLOQUE_FALTA',
        `${nota.id} no tiene el bloque gestionado «${nombre}» (se creó a mano o con una plantilla anterior a la 1.2.0): edita esa sección a mano en Obsidian o agrégale sus marcadores.`,
      );
    }
    if (bloque.editadoAMano) avisos.push(`ATENCIÓN: el bloque «${nombre}» fue editado a mano; al aplicar se pierden esos cambios.`);
  }

  const nombres = [...propiedades.map(([clave]) => clave), ...bloques.keys()];
  const detalles = [`pidió: ${d.pedido_por}`, d.motivo ? `motivo: ${d.motivo}` : ''].filter((x) => x !== '').join(' · ');
  return prepararEdicion(ctx, guardia, nota, {
    herramienta: 'funcionalidad_actualizar',
    historial: `actualizada: ${nombres.join(', ')} · ${detalles}`,
    editar: (doc) => {
      for (const [clave, valor] of propiedades) doc.set(clave, valor);
    },
    cuerpo:
      bloques.size === 0
        ? undefined
        : (cuerpo, eol) => [...bloques].reduce((c, [nombre, texto]) => escribirBloque(c, nombre, envolver(texto).replace(/\r?\n/g, eol), eol), cuerpo),
    avisos,
  });
}

// ——— Versión 1.1.0 ———

export type DatosGuia = {
  key: string;
  titulo: string;
  proposito: string;
  pasos: string;
  problemas?: string;
  afirmaciones: Afirmacion[];
  evidence: string;
  reviewed_commit: string;
  fuentes: string[];
  area?: string[];
  relacionadas?: string[];
  pendientes?: string[];
};

// Una guía explica CÓMO usar algo que ya existe (un flujo, un agente, el sistema completo).
// Lleva la misma evidencia que una funcionalidad, así que notas_desactualizadas también la revisa.
export async function prepararGuia(ctx: Contexto, guardia: Guardia, indice: Indice, d: DatosGuia): Promise<Preparado> {
  exigirKeyLibre(indice, d.key);
  return prepararCreacion(ctx, guardia, indice, {
    tipo: 'guia',
    carpeta: ctx.config.carpetas.guias,
    titulo: d.titulo,
    propiedades: {
      key: d.key,
      area: d.area ?? [],
      evidence: d.evidence,
      reviewed_commit: d.reviewed_commit,
      reviewed_on: ahora(ctx.config.zona_horaria).fecha,
      source: d.fuentes,
      related: enlacesA(ctx, indice, d.relacionadas),
    },
    valores: {
      proposito: d.proposito,
      pasos: d.pasos,
      problemas: d.problemas === undefined || d.problemas === '' ? '(ninguno registrado)' : d.problemas,
      afirmaciones: filasAfirmaciones(d.afirmaciones),
      pendientes: listaPendientes(ctx, indice, d.pendientes),
    },
    herramienta: 'guia_crear',
  });
}

export type DatosAdr = {
  titulo: string;
  contexto: string;
  decision: string;
  alternativas: string;
  consecuencias: string;
  deciders: string[];
  evidence: string;
  fuentes: string[];
  area?: string[];
  supersedes?: string[];
  relacionadas?: string[];
};

// Una decisión nace «Propuesta». Pasarla a «Aceptada» (con decided) lo haces tú en Obsidian.
export async function prepararAdr(ctx: Contexto, guardia: Guardia, indice: Indice, d: DatosAdr): Promise<Preparado> {
  return prepararCreacion(ctx, guardia, indice, {
    tipo: 'decision',
    carpeta: ctx.config.carpetas.decisiones,
    titulo: d.titulo,
    propiedades: {
      decision_status: 'Propuesta',
      deciders: d.deciders,
      supersedes: enlacesA(ctx, indice, d.supersedes),
      area: d.area ?? [],
      evidence: d.evidence,
      source: d.fuentes,
      related: enlacesA(ctx, indice, d.relacionadas),
    },
    valores: { contexto: d.contexto, decision: d.decision, alternativas: d.alternativas, consecuencias: d.consecuencias },
    herramienta: 'adr_crear',
  });
}

export type DatosIncidencia = {
  titulo: string;
  sintoma: string;
  impacto: string;
  causa?: string;
  severity: string;
  environment: string;
  detected: string;
  prioridad: string;
  area?: string[];
  release?: string;
  fuentes: string[];
  relacionadas?: string[];
  pedido_por: string;
};

// Una incidencia usa los mismos estados que una tarea (y tarea_cambiar_estado desde esta etapa).
export async function prepararIncidencia(ctx: Contexto, guardia: Guardia, indice: Indice, d: DatosIncidencia): Promise<Preparado> {
  return prepararCreacion(ctx, guardia, indice, {
    tipo: 'incidencia',
    carpeta: ctx.config.carpetas.incidencias,
    titulo: d.titulo,
    propiedades: {
      status: 'Por hacer',
      priority: d.prioridad,
      severity: d.severity,
      environment: d.environment,
      detected: d.detected,
      area: d.area ?? [],
      release: d.release === undefined ? undefined : enlacesA(ctx, indice, [d.release])[0],
      source: d.fuentes,
      related: enlacesA(ctx, indice, d.relacionadas),
    },
    valores: { sintoma: d.sintoma, impacto: d.impacto, causa: d.causa ?? 'Pendiente de validar.' },
    historial: `creada en «Por hacer» · pidió: ${d.pedido_por}`,
    herramienta: 'incidencia_crear',
  });
}
