import type { Contexto } from './arranque.ts';
import { crear, editar } from './cambios.ts';
import type { Preparado } from './cambios.ts';
import { ahora, limpiarTextoLibre } from './dominio.ts';
import { ErrorMcp } from './errores.ts';
import type { Guardia } from './guardia.ts';
import { enlacesA, notaVigente } from './notas.ts';
import type { Indice } from './notas.ts';

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
  const enlaces = enlacesA(ctx.config.project_dir, indice, ids);
  return enlaces.length === 0 ? '(ninguno)' : enlaces.map((e) => `- ${e}`).join('\n');
}

// Una línea en blanco antes y después del contenido: en Markdown, una tabla pegada a un marcador
// no se dibuja, y la línea pegada debajo de una tabla se vuelve otra fila.
function envolver(texto: string): string {
  return `\n${texto}\n`;
}

export async function prepararFuncionalidad(ctx: Contexto, guardia: Guardia, indice: Indice, entrada: DatosFuncionalidad): Promise<Preparado> {
  const d = limpiarTextoLibre(entrada, ctx.config.limites.campo_max_kb);
  exigirKeyLibre(indice, d.key);
  return crear(ctx, guardia, indice, {
    tipo: 'funcionalidad',
    id: { numerar: 'funcionalidad' },
    carpeta: ctx.config.carpetas.funcionalidades,
    titulo: d.titulo,
    propiedades: {
      key: d.key,
      area: d.area ?? [],
      evidence: d.evidence,
      reviewed_commit: d.reviewed_commit,
      reviewed_on: ahora(ctx.config.zona_horaria).fecha,
      source: d.fuentes,
      related: enlacesA(ctx.config.project_dir, indice, d.relacionadas),
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

// ——— Actualizar notas con evidencia: funcionalidades (1.2.0) y guías (2.1.0) ———

// Lo común a las dos: propiedades de revisión y los bloques de afirmaciones y pendientes.
type DatosActualizacionConEvidencia = {
  id: string;
  version_esperada: string;
  pedido_por: string;
  motivo?: string;
  titulo?: string;
  afirmaciones?: Afirmacion[];
  evidence?: string;
  reviewed_commit?: string;
  fuentes?: string[];
  area?: string[];
  relacionadas?: string[];
  pendientes?: string[];
};

export type DatosActualizacionFuncionalidad = DatosActualizacionConEvidencia & { que_hace?: string };
export type DatosActualizacionGuia = DatosActualizacionConEvidencia & { proposito?: string; pasos?: string; problemas?: string };

type TipoConEvidencia = { tipo: 'funcionalidad' | 'guia'; nombre: string; herramienta: string };

export async function prepararActualizacionFuncionalidad(ctx: Contexto, guardia: Guardia, indice: Indice, entrada: DatosActualizacionFuncionalidad): Promise<Preparado> {
  const d = limpiarTextoLibre(entrada, ctx.config.limites.campo_max_kb);
  const tipo = { tipo: 'funcionalidad', nombre: 'la funcionalidad', herramienta: 'funcionalidad_actualizar' } as const;
  return prepararActualizacionConEvidencia(ctx, guardia, indice, tipo, d, [['que_hace', d.que_hace]]);
}

export async function prepararActualizacionGuia(ctx: Contexto, guardia: Guardia, indice: Indice, entrada: DatosActualizacionGuia): Promise<Preparado> {
  const d = limpiarTextoLibre(entrada, ctx.config.limites.campo_max_kb);
  const tipo = { tipo: 'guia', nombre: 'la guía', herramienta: 'guia_actualizar' } as const;
  return prepararActualizacionConEvidencia(ctx, guardia, indice, tipo, d, [
    ['proposito', d.proposito],
    ['pasos', d.pasos],
    ['problemas', d.problemas === undefined ? undefined : textoProblemas(d.problemas)],
  ]);
}

// Edita una nota con evidencia. La key no cambia: es su identidad natural.
// Solo reescribe propiedades de una lista cerrada y los bloques gestionados; «Notas» y todo lo
// que esté fuera de los bloques queda igual, byte a byte.
// textos: los bloques de texto propios del tipo, en el orden en que aparecen en la nota.
async function prepararActualizacionConEvidencia(
  ctx: Contexto,
  guardia: Guardia,
  indice: Indice,
  t: TipoConEvidencia,
  d: DatosActualizacionConEvidencia,
  textos: [string, string | undefined][],
): Promise<Preparado> {
  const nota = notaVigente(indice, d.id, d.version_esperada, [t.tipo], t.nombre);
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
  if (d.relacionadas !== undefined) propiedades.push(['related', enlacesA(ctx.config.project_dir, indice, d.relacionadas)]);

  const bloques: Record<string, string> = {};
  for (const [nombre, texto] of textos) if (texto !== undefined) bloques[nombre] = envolver(texto);
  if (d.afirmaciones !== undefined) bloques.afirmaciones = envolver(tablaAfirmaciones(d.afirmaciones));
  if (d.pendientes !== undefined) bloques.pendientes = envolver(listaPendientes(ctx, indice, d.pendientes));

  const nombres = [...propiedades.map(([clave]) => clave), ...Object.keys(bloques)];
  if (nombres.length === 0) throw new ErrorMcp('SIN_CAMBIOS', 'No indicaste ningún campo para actualizar.');
  const detalles = [`pidió: ${d.pedido_por}`, d.motivo ? `motivo: ${d.motivo}` : ''].filter((x) => x !== '').join(' · ');
  return editar(ctx, guardia, nota, { herramienta: t.herramienta, historial: `actualizada: ${nombres.join(', ')} · ${detalles}`, propiedades, bloques });
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

function textoProblemas(problemas: string | undefined): string {
  return problemas === undefined || problemas === '' ? '(ninguno registrado)' : problemas;
}

// Una guía explica CÓMO usar algo que ya existe (un flujo, un agente, el sistema completo).
// Lleva la misma evidencia que una funcionalidad, así que notas_desactualizadas también la revisa.
// Desde la 2.1.0 su contenido va en bloques gestionados (guia_actualizar los reescribe).
export async function prepararGuia(ctx: Contexto, guardia: Guardia, indice: Indice, entrada: DatosGuia): Promise<Preparado> {
  const d = limpiarTextoLibre(entrada, ctx.config.limites.campo_max_kb);
  exigirKeyLibre(indice, d.key);
  const problemas = textoProblemas(d.problemas);
  const pendientes = listaPendientes(ctx, indice, d.pendientes);
  return crear(ctx, guardia, indice, {
    tipo: 'guia',
    id: { numerar: 'guia' },
    carpeta: ctx.config.carpetas.guias,
    titulo: d.titulo,
    propiedades: {
      key: d.key,
      area: d.area ?? [],
      evidence: d.evidence,
      reviewed_commit: d.reviewed_commit,
      reviewed_on: ahora(ctx.config.zona_horaria).fecha,
      source: d.fuentes,
      related: enlacesA(ctx.config.project_dir, indice, d.relacionadas),
    },
    // Solo los usa una plantilla propia en el formato anterior a la 2.1.0 (campos {{…}}, sin bloques).
    valores: { proposito: d.proposito, pasos: d.pasos, problemas, afirmaciones: filasAfirmaciones(d.afirmaciones), pendientes },
    bloques: {
      proposito: envolver(d.proposito),
      pasos: envolver(d.pasos),
      problemas: envolver(problemas),
      afirmaciones: envolver(tablaAfirmaciones(d.afirmaciones)),
      pendientes: envolver(pendientes),
    },
    historial: `creada · revisada en ${d.reviewed_commit}`,
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
export async function prepararAdr(ctx: Contexto, guardia: Guardia, indice: Indice, entrada: DatosAdr): Promise<Preparado> {
  const d = limpiarTextoLibre(entrada, ctx.config.limites.campo_max_kb);
  return crear(ctx, guardia, indice, {
    tipo: 'decision',
    id: { numerar: 'decision' },
    carpeta: ctx.config.carpetas.decisiones,
    titulo: d.titulo,
    propiedades: {
      decision_status: 'Propuesta',
      deciders: d.deciders,
      supersedes: enlacesA(ctx.config.project_dir, indice, d.supersedes),
      area: d.area ?? [],
      evidence: d.evidence,
      source: d.fuentes,
      related: enlacesA(ctx.config.project_dir, indice, d.relacionadas),
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
export async function prepararIncidencia(ctx: Contexto, guardia: Guardia, indice: Indice, entrada: DatosIncidencia): Promise<Preparado> {
  const d = limpiarTextoLibre(entrada, ctx.config.limites.campo_max_kb);
  return crear(ctx, guardia, indice, {
    tipo: 'incidencia',
    id: { numerar: 'incidencia' },
    carpeta: ctx.config.carpetas.incidencias,
    titulo: d.titulo,
    propiedades: {
      status: 'Por hacer',
      priority: d.prioridad,
      severity: d.severity,
      environment: d.environment,
      detected: d.detected,
      area: d.area ?? [],
      release: d.release === undefined ? undefined : enlacesA(ctx.config.project_dir, indice, [d.release])[0],
      source: d.fuentes,
      related: enlacesA(ctx.config.project_dir, indice, d.relacionadas),
    },
    valores: { sintoma: d.sintoma, impacto: d.impacto, causa: d.causa ?? 'Pendiente de validar.' },
    historial: `creada en «Por hacer» · pidió: ${d.pedido_por}`,
    herramienta: 'incidencia_crear',
  });
}
