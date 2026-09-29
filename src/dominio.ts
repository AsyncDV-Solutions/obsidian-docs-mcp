// Vocabulario del dominio: listas cerradas y reglas puras. Este archivo no toca el disco.
import { ErrorMcp } from './errores.ts';

export const TIPOS = ['proyecto', 'contadores', 'tarea', 'funcionalidad', 'incidencia', 'decision', 'release', 'referencia', 'guia'] as const;
export type TipoNota = (typeof TIPOS)[number];

export const TIPOS_ITEM = ['tarea', 'funcionalidad', 'incidencia', 'decision', 'release', 'guia'] as const;
export type TipoItem = (typeof TIPOS_ITEM)[number];

export const ESTADOS = ['Por hacer', 'Pendiente', 'En curso', 'Bloqueado', 'Completado'] as const;
export type Estado = (typeof ESTADOS)[number];

export const PRIORIDADES = ['P0', 'P1', 'P2', 'P3'] as const;
export const RESOLUCIONES = ['hecha', 'cancelada', 'duplicada'] as const;
export type Resolucion = (typeof RESOLUCIONES)[number];

// Letra de cada tipo numerado dentro del ID (con el prefijo del proyecto): PRJ-T-0001, PRJ-F-0001, PRJ-I-0001, PRJ-ADR-0001 y PRJ-G-0001.
export const LETRA = { tarea: 'T', funcionalidad: 'F', incidencia: 'I', decision: 'ADR', guia: 'G' } as const;
export type TipoNumerado = keyof typeof LETRA;

// ¿El id tiene el formato de su tipo? El marcador, los contadores y las referencias no llevan id.
export function idValido(id: string, tipo: string, prefijo: string): boolean {
  if (tipo === 'release') return new RegExp(`^${prefijo}-R-v\\d+\\.\\d+\\.\\d+$`).test(id);
  if (Object.hasOwn(LETRA, tipo)) {
    return new RegExp(`^${prefijo}-${LETRA[tipo as TipoNumerado]}-\\d{4,}$`).test(id);
  }
  return id === '';
}

// Minúsculas, sin tildes y con espacios simples: para buscar y para detectar títulos repetidos.
export function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// ——— Nombres de archivo, fechas y transiciones ———

// Apto para nombres de archivo: ASCII, minúsculas, sin tildes, con guiones y hasta 60 caracteres.
export function slug(titulo: string): string {
  const base = normalizar(titulo).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
  return base === '' ? 'sin-titulo' : base;
}

export type Momento = { fecha: string; fechaHora: string; legible: string };

// Fecha y hora en la zona del proyecto, con su desfase: -03:00 o -04:00 según la época del año.
export function ahora(zona: string, instante: Date = new Date()): Momento {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'longOffset',
  }).formatToParts(instante);
  const parte = (tipo: string): string => partes.find((p) => p.type === tipo)?.value ?? '';
  const fecha = `${parte('year')}-${parte('month')}-${parte('day')}`;
  const hora = `${parte('hour')}:${parte('minute')}`;
  const desfase = parte('timeZoneName').replace('GMT', '') || '+00:00';
  return { fecha, fechaHora: `${fecha}T${hora}:${parte('second')}`, legible: `${fecha} ${hora} (${desfase})` };
}

export type PedidoTransicion = {
  destino: Estado;
  motivo?: string;
  resolution?: Resolucion;
  blocked_by?: string[];
  blocked_reason?: string;
};

// Problemas que impiden una transición (una lista vacía significa que está permitida).
export function problemasDeTransicion(origen: string, p: PedidoTransicion, criteriosPendientes: number): string[] {
  const problemas: string[] = [];
  const motivo = p.motivo?.trim() ?? '';
  if (origen === 'Completado' && p.destino !== 'Completado' && motivo === '') {
    problemas.push('Reabrir una tarea exige motivo.');
  }
  if (p.destino === 'Pendiente' && motivo === '') {
    problemas.push('«Pendiente» exige un motivo que diga qué evento o condición se espera.');
  }
  if (p.destino === 'Bloqueado' && (p.blocked_by?.length ?? 0) === 0 && (p.blocked_reason?.trim() ?? '') === '') {
    problemas.push('«Bloqueado» exige blocked_by o blocked_reason.');
  }
  if (p.destino === 'Completado') {
    if (p.resolution === undefined) {
      problemas.push('«Completado» exige resolution: hecha, cancelada o duplicada.');
    } else if (p.resolution === 'hecha' && criteriosPendientes > 0) {
      problemas.push(`Quedan ${criteriosPendientes} criterio(s) de aceptación sin marcar.`);
    } else if (p.resolution !== 'hecha' && motivo === '') {
      problemas.push(`resolution «${p.resolution}» exige motivo.`);
    }
  } else if (p.resolution !== undefined) {
    problemas.push('resolution solo se usa al pasar a «Completado».');
  }
  return problemas;
}

// Casillas sin marcar dentro de la sección «Criterios de aceptación».
export function criteriosPendientes(cuerpo: string): number {
  let dentro = false;
  let pendientes = 0;
  for (const linea of cuerpo.split(/\r?\n/)) {
    if (linea.startsWith('## ')) dentro = /^## Criterios de aceptación\s*$/.test(linea);
    else if (dentro && /^\s*- \[ \]/.test(linea)) pendientes++;
  }
  return pendientes;
}

// Agrega una casilla al final de la sección «Criterios de aceptación».
export function agregarCriterio(cuerpo: string, criterio: string, eol: string): string {
  const lineas = cuerpo.split(/\r?\n/);
  const inicio = lineas.findIndex((l) => /^## Criterios de aceptación\s*$/.test(l));
  if (inicio === -1) throw new ErrorMcp('SIN_SECCION', 'La nota no tiene la sección «## Criterios de aceptación».');
  let fin = lineas.findIndex((l, i) => i > inicio && l.startsWith('## '));
  if (fin === -1) fin = lineas.length;
  let insertar = fin;
  while (insertar > inicio + 1 && (lineas[insertar - 1] ?? '').trim() === '') insertar--;
  lineas.splice(insertar, 0, `- [ ] ${criterio}`);
  return lineas.join(eol);
}

// ——— Documentos ———
// Etiquetas de evidencia y severidades de una incidencia. Las áreas y los ambientes se configuran (config.ts).
export const EVIDENCIAS = ['verificado-en-codigo', 'solo-documentacion', 'propuesto', 'pendiente-de-validar'] as const;
export const SEVERIDADES = ['critica', 'alta', 'media', 'baja'] as const;
