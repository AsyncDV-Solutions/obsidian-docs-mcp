import type { Contexto } from './arranque.ts';
import type { Sesion } from './sesion.ts';
import { crear, editar } from './cambios.ts';
import type { Preparado } from './cambios.ts';
import { ahora, limpiarTextoLibre, quienPide } from './dominio.ts';
import { ErrorMcp } from './errores.ts';
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

export async function prepararFuncionalidad(sesion: Sesion, sinLimpiar: DatosFuncionalidad): Promise<Preparado> {
  const datos = limpiarTextoLibre(sinLimpiar, sesion.config.limites.campo_max_kb);
  const indice = await sesion.indice();
  exigirKeyLibre(indice, datos.key);
  return crear(sesion, indice, {
    tipo: 'funcionalidad',
    id: { numerar: 'funcionalidad' },
    carpeta: sesion.config.carpetas.funcionalidades,
    titulo: datos.titulo,
    propiedades: {
      key: datos.key,
      area: datos.area ?? [],
      evidence: datos.evidence,
      reviewed_commit: datos.reviewed_commit,
      reviewed_on: ahora(sesion.config.zona_horaria).fecha,
      source: datos.fuentes,
      related: enlacesA(sesion.config.project_dir, indice, datos.relacionadas),
    },
    valores: {},
    bloques: {
      que_hace: envolver(datos.que_hace),
      afirmaciones: envolver(tablaAfirmaciones(datos.afirmaciones)),
      pendientes: envolver(listaPendientes(sesion, indice, datos.pendientes)),
    },
    historial: `creada · revisada en ${datos.reviewed_commit}`,
    herramienta: 'funcionalidad_crear',
  });
}

// ——— Actualizar notas con evidencia: funcionalidades (1.2.0) y guías (2.1.0) ———

// Lo común a las dos: propiedades de revisión y los bloques de afirmaciones y pendientes.
type DatosActualizacionConEvidencia = {
  id: string;
  version_esperada: string;
  pedido_por?: string | undefined;
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

export async function prepararActualizacionFuncionalidad(sesion: Sesion, sinLimpiar: DatosActualizacionFuncionalidad): Promise<Preparado> {
  const datos = limpiarTextoLibre(sinLimpiar, sesion.config.limites.campo_max_kb);
  const tipo = { tipo: 'funcionalidad', nombre: 'la funcionalidad', herramienta: 'funcionalidad_actualizar' } as const;
  return prepararActualizacionConEvidencia(sesion, tipo, datos, [['que_hace', datos.que_hace]]);
}

export async function prepararActualizacionGuia(sesion: Sesion, sinLimpiar: DatosActualizacionGuia): Promise<Preparado> {
  const datos = limpiarTextoLibre(sinLimpiar, sesion.config.limites.campo_max_kb);
  const tipo = { tipo: 'guia', nombre: 'la guía', herramienta: 'guia_actualizar' } as const;
  return prepararActualizacionConEvidencia(sesion, tipo, datos, [
    ['proposito', datos.proposito],
    ['pasos', datos.pasos],
    ['problemas', datos.problemas === undefined ? undefined : textoProblemas(datos.problemas)],
  ]);
}

// Edita una nota con evidencia. La key no cambia: es su identidad natural.
// Solo reescribe propiedades de una lista cerrada y los bloques gestionados; «Notas» y todo lo
// que esté fuera de los bloques queda igual, byte a byte.
// textos: los bloques de texto propios del tipo, en el orden en que aparecen en la nota.
async function prepararActualizacionConEvidencia(
  sesion: Sesion,
  t: TipoConEvidencia,
  datos: DatosActualizacionConEvidencia,
  textos: [string, string | undefined][],
): Promise<Preparado> {
  const pedidoPor = quienPide(sesion.config, datos.pedido_por);
  const indice = await sesion.indice();
  const nota = notaVigente(indice, datos.id, datos.version_esperada, [t.tipo], t.nombre);
  // Afirmaciones, fuentes y evidencia son una revisión nueva: sin el SHA revisado no se sabe contra qué código valen.
  if ((datos.afirmaciones !== undefined || datos.fuentes !== undefined || datos.evidence !== undefined) && datos.reviewed_commit === undefined) {
    throw new ErrorMcp('FALTA_COMMIT', 'Cambiar afirmaciones, fuentes o evidence exige reviewed_commit: el SHA contra el que revisaste.');
  }

  const propiedades: [string, unknown][] = [];
  if (datos.titulo !== undefined) propiedades.push(['title', datos.titulo]); // el nombre del archivo no cambia
  if (datos.area !== undefined) propiedades.push(['area', datos.area]);
  if (datos.evidence !== undefined) propiedades.push(['evidence', datos.evidence]);
  if (datos.reviewed_commit !== undefined) {
    propiedades.push(['reviewed_commit', datos.reviewed_commit], ['reviewed_on', ahora(sesion.config.zona_horaria).fecha]);
  }
  if (datos.fuentes !== undefined) propiedades.push(['source', datos.fuentes]);
  if (datos.relacionadas !== undefined) propiedades.push(['related', enlacesA(sesion.config.project_dir, indice, datos.relacionadas)]);

  const bloques: Record<string, string> = {};
  for (const [nombre, texto] of textos) if (texto !== undefined) bloques[nombre] = envolver(texto);
  if (datos.afirmaciones !== undefined) bloques.afirmaciones = envolver(tablaAfirmaciones(datos.afirmaciones));
  if (datos.pendientes !== undefined) bloques.pendientes = envolver(listaPendientes(sesion, indice, datos.pendientes));

  const nombres = [...propiedades.map(([clave]) => clave), ...Object.keys(bloques)];
  if (nombres.length === 0) throw new ErrorMcp('SIN_CAMBIOS', 'No indicaste ningún campo para actualizar.');
  const detalles = [`pidió: ${pedidoPor}`, datos.motivo ? `motivo: ${datos.motivo}` : ''].filter((x) => x !== '').join(' · ');
  return editar(sesion, nota, { herramienta: t.herramienta, historial: `actualizada: ${nombres.join(', ')} · ${detalles}`, propiedades, bloques });
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
export async function prepararGuia(sesion: Sesion, sinLimpiar: DatosGuia): Promise<Preparado> {
  const datos = limpiarTextoLibre(sinLimpiar, sesion.config.limites.campo_max_kb);
  const indice = await sesion.indice();
  exigirKeyLibre(indice, datos.key);
  const problemas = textoProblemas(datos.problemas);
  const pendientes = listaPendientes(sesion, indice, datos.pendientes);
  return crear(sesion, indice, {
    tipo: 'guia',
    id: { numerar: 'guia' },
    carpeta: sesion.config.carpetas.guias,
    titulo: datos.titulo,
    propiedades: {
      key: datos.key,
      area: datos.area ?? [],
      evidence: datos.evidence,
      reviewed_commit: datos.reviewed_commit,
      reviewed_on: ahora(sesion.config.zona_horaria).fecha,
      source: datos.fuentes,
      related: enlacesA(sesion.config.project_dir, indice, datos.relacionadas),
    },
    // Solo los usa una plantilla propia en el formato anterior a la 2.1.0 (campos {{…}}, sin bloques).
    valores: { proposito: datos.proposito, pasos: datos.pasos, problemas, afirmaciones: filasAfirmaciones(datos.afirmaciones), pendientes },
    bloques: {
      proposito: envolver(datos.proposito),
      pasos: envolver(datos.pasos),
      problemas: envolver(problemas),
      afirmaciones: envolver(tablaAfirmaciones(datos.afirmaciones)),
      pendientes: envolver(pendientes),
    },
    historial: `creada · revisada en ${datos.reviewed_commit}`,
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
export async function prepararAdr(sesion: Sesion, sinLimpiar: DatosAdr): Promise<Preparado> {
  const datos = limpiarTextoLibre(sinLimpiar, sesion.config.limites.campo_max_kb);
  const indice = await sesion.indice();
  return crear(sesion, indice, {
    tipo: 'decision',
    id: { numerar: 'decision' },
    carpeta: sesion.config.carpetas.decisiones,
    titulo: datos.titulo,
    propiedades: {
      decision_status: 'Propuesta',
      deciders: datos.deciders,
      supersedes: enlacesA(sesion.config.project_dir, indice, datos.supersedes),
      area: datos.area ?? [],
      evidence: datos.evidence,
      source: datos.fuentes,
      related: enlacesA(sesion.config.project_dir, indice, datos.relacionadas),
    },
    valores: { contexto: datos.contexto, decision: datos.decision, alternativas: datos.alternativas, consecuencias: datos.consecuencias },
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
  pedido_por?: string | undefined;
};

// Una incidencia usa los mismos estados que una tarea (y tarea_cambiar_estado desde esta etapa).
export async function prepararIncidencia(sesion: Sesion, sinLimpiar: DatosIncidencia): Promise<Preparado> {
  const datos = limpiarTextoLibre(sinLimpiar, sesion.config.limites.campo_max_kb);
  const pedidoPor = quienPide(sesion.config, datos.pedido_por);
  const indice = await sesion.indice();
  return crear(sesion, indice, {
    tipo: 'incidencia',
    id: { numerar: 'incidencia' },
    carpeta: sesion.config.carpetas.incidencias,
    titulo: datos.titulo,
    propiedades: {
      status: 'Por hacer',
      priority: datos.prioridad,
      severity: datos.severity,
      environment: datos.environment,
      detected: datos.detected,
      area: datos.area ?? [],
      release: datos.release === undefined ? undefined : enlacesA(sesion.config.project_dir, indice, [datos.release])[0],
      source: datos.fuentes,
      related: enlacesA(sesion.config.project_dir, indice, datos.relacionadas),
    },
    valores: { sintoma: datos.sintoma, impacto: datos.impacto, causa: datos.causa ?? 'Pendiente de validar.' },
    historial: `creada en «Por hacer» · pidió: ${pedidoPor}`,
    herramienta: 'incidencia_crear',
  });
}
