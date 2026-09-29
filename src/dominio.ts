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

// Minúsculas, sin tildes y con espacios simples: para buscar y para detectar títulos repetidos.
export function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// ——— Texto libre ———

// El texto libre es todo lo que aporta el modelo y termina escrito en una nota. Cada cadena tiene un
// tope de tamaño (en bytes) y no puede llevar marcadores de bloque gestionado: con ellos, el texto
// podría cerrar un bloque antes de tiempo o abrir otro. Devuelve una copia con las cadenas recortadas
// y nombra el campo en el error (p. ej. «secciones.corregido[1]»). Recorre arreglos y objetos planos;
// todo lo demás (números, fechas, null) lo devuelve tal cual.
// Quién pidió el cambio: el que indicó el modelo o, si no indicó ninguno, el usuario configurado. Va después de
// limpiarTextoLibre, así el texto inválido se rechaza antes que la falta de pedido_por.
export function quienPide(usuario: string | undefined, valor: string | undefined): string {
  const quien = valor ?? usuario;
  if (quien === undefined) {
    throw new ErrorMcp('FALTA_PEDIDO_POR', 'Indica pedido_por (quién pidió el cambio) o configura «usuario» / ASYNCDV_DOCS_USUARIO.');
  }
  return quien;
}

export function limpiarTextoLibre<T>(valor: T, maxKb: number, campo = ''): T {
  if (typeof valor === 'string') {
    if (Buffer.byteLength(valor, 'utf8') > maxKb * 1024) {
      throw new ErrorMcp('CAMPO_GRANDE', `«${campo}» supera los ${maxKb} KB.`);
    }
    if (valor.includes('%% asyncdv:')) {
      throw new ErrorMcp('CAMPO_INVALIDO', `«${campo}» no puede contener marcadores «%% asyncdv:».`);
    }
    return valor.trim() as T;
  }
  if (Array.isArray(valor)) return valor.map((v, i) => limpiarTextoLibre(v, maxKb, `${campo}[${i}]`)) as T;
  if (typeof valor === 'object' && valor !== null && [Object.prototype, null].includes(Object.getPrototypeOf(valor))) {
    const limpio: Record<string, unknown> = {};
    for (const [clave, v] of Object.entries(valor)) limpio[clave] = limpiarTextoLibre(v, maxKb, campo === '' ? clave : `${campo}.${clave}`);
    return limpio as T;
  }
  return valor;
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
