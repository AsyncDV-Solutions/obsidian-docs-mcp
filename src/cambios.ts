// Cambios preparados: el único módulo que arma el contenido nuevo de una nota y lo deja listo
// para aplicar. Un cambio preparado no escribe nada: devuelve una vista previa y un código de
// confirmación de un solo uso que aplicar.ts consume.
//
// Invariantes que viven acá y en ningún otro lado:
//   - La vista previa se genera desde las operaciones: la persona aprueba exactamente lo que se escribe.
//   - Toda operación de reemplazo va pinneada a la versión releída de la nota (concurrencia optimista).
//   - BOM y saltos de línea de la nota se conservan; «updated» se renueva en cada edición.
//   - Crear una nota numerada reemplaza _contadores.md pinneado a su versión: aplicar una creación
//     invalida las otras vistas previas de creación (nunca se reparte un número dos veces).
import { Document } from 'yaml';
import type { Contexto } from './arranque.ts';
import { escribirBloque, leerBloque } from './bloques.ts';
import { consumirCupo, diffLineas, guardarCambio, tomarCambio } from './confirmaciones.ts';
import type { Cambio } from './confirmaciones.ts';
import { ahora, slug } from './dominio.ts';
import type { TipoNumerado } from './dominio.ts';
import { ErrorMcp } from './errores.ts';
import { separarNota, unirNota } from './frontmatter.ts';
import type { Guardia, Leida } from './guardia.ts';
import { claveContador, formatearId, RUTA_CONTADORES, siguienteNumero } from './ids.ts';
import type { Indice, Nota } from './notas.ts';
import { cargarPlantilla, rellenar } from './plantillas.ts';
import type { TipoPlantilla } from './plantillas.ts';

export type Preparado = { confirmacion: string; expira: Date; vistaPrevia: string };

export type { Cambio, Operacion } from './confirmaciones.ts';

// Operaciones con lo necesario para la vista previa: un reemplazo recuerda el texto anterior para el diff.
type Op = { tipo: 'crear'; ruta: string; contenido: string } | { tipo: 'reemplazar'; ruta: string; contenido: string; versionEsperada: string; antes: string };

// Registra el cambio y arma la vista previa: avisos primero, después las notas nuevas completas y al
// final los diffs de las reemplazadas. Las operaciones se aplican en el orden recibido, no en este.
function preparar(ctx: Contexto, descripcion: string, ops: Op[], avisos: string[] = []): Preparado {
  const cambio: Cambio = {
    descripcion,
    operaciones: ops.map((op) =>
      op.tipo === 'crear' ? { tipo: 'crear', ruta: op.ruta, contenido: op.contenido } : { tipo: 'reemplazar', ruta: op.ruta, contenido: op.contenido, versionEsperada: op.versionEsperada },
    ),
  };
  const paraLeer = [...ops.filter((op) => op.tipo === 'crear'), ...ops.filter((op) => op.tipo === 'reemplazar')];
  const cuerpo = paraLeer.map((op) => (op.tipo === 'crear' ? `Crear ${op.ruta}:\n———\n${op.contenido}\n———` : `Cambios en ${op.ruta}:\n${diffLineas(op.antes, op.contenido)}`));
  const { confirmacion, expira } = guardarCambio(cambio, ctx.config.limites.confirmacion_minutos);
  return { confirmacion, expira, vistaPrevia: [...avisos, ...cuerpo].join('\n') };
}

// Entrega el cambio a aplicar.ts una sola vez. El tope de escrituras por minuto se comprueba ANTES de
// consumir el código: alcanzar el tope es una pausa, no una invalidación. Todo lo que falle después
// de tomarlo sí lo consume: aunque aplicar falle a medias, el código ya no sirve.
export function tomar(confirmacion: string, maxPorMinuto: number): Cambio {
  consumirCupo(maxPorMinuto);
  return tomarCambio(confirmacion);
}

function avisoEditadoAMano(nombre: string): string {
  return `ATENCIÓN: el bloque «${nombre}» fue editado a mano; al aplicar se pierden esos cambios.`;
}

// ——— Crear ———

export type PedidoCrear = {
  tipo: TipoPlantilla;
  // Numerada (PRJ-T-0001, archivo «<id>-<slug>.md») o con id propio (PRJ-R-v1.0.0, archivo «<id>.md»).
  id: string | { numerar: TipoNumerado };
  carpeta: string; // relativa al proyecto, p. ej. 'Tareas' (config.carpetas). Debe existir
  titulo: string;
  propiedades: Record<string, unknown>; // las propias del tipo, en el orden deseado; undefined se omite
  valores: Record<string, string>; // campos {{…}} de la plantilla
  // Contenido de los bloques gestionados (se escriben con huella). Una plantilla propia en un formato
  // anterior no trae esos bloques: ese contenido entra por sus campos {{…}} y el bloque se omite.
  bloques?: Record<string, string>;
  historial?: string; // primera línea del historial, si la plantilla lo tiene
  herramienta: string;
};

// El contador: leer, validar, calcular el siguiente número y preparar su reemplazo.
async function numerar(ctx: Contexto, guardia: Guardia, indice: Indice, tipo: TipoNumerado): Promise<{ id: string; op: Op }> {
  const cfg = ctx.config;
  let contadores: Leida;
  try {
    contadores = await guardia.leer(RUTA_CONTADORES);
  } catch (error) {
    if (error instanceof ErrorMcp && error.codigo === 'NOTA_NO_EXISTE') {
      throw new ErrorMcp('CONTADORES_FALTA', `Falta ${RUTA_CONTADORES} en la carpeta del proyecto: créalo con «pnpm run iniciar».`);
    }
    throw error;
  }
  const sep = separarNota(contadores.texto, cfg.limites.yaml_max_kb * 1024);
  if (sep.datos.project_id !== cfg.project_id || sep.datos.type !== 'contadores') {
    throw new ErrorMcp('CONTADORES_INVALIDO', `${RUTA_CONTADORES} no es la nota de contadores de este proyecto.`);
  }
  const numero = siguienteNumero(tipo, cfg.id_prefix, sep.datos, indice.notas);
  sep.doc.set(claveContador(tipo), numero);
  const contenido = unirNota({ bom: sep.bom, eol: sep.eol, doc: sep.doc, cuerpo: sep.cuerpo });
  return { id: formatearId(cfg.id_prefix, tipo, numero), op: { tipo: 'reemplazar', ruta: RUTA_CONTADORES, contenido, versionEsperada: contadores.version, antes: contadores.texto } };
}

// Prepara una nota nueva: propiedades armadas por código + cuerpo de la plantilla con sus bloques.
export async function crear(ctx: Contexto, guardia: Guardia, indice: Indice, p: PedidoCrear): Promise<Preparado> {
  const cfg = ctx.config;
  const momento = ahora(cfg.zona_horaria);
  const ops: Op[] = [];
  let id: string;
  if (typeof p.id === 'string') {
    id = p.id;
  } else {
    ({ id, op: ops[0] } = await numerar(ctx, guardia, indice, p.id.numerar));
  }
  const ruta = typeof p.id === 'string' ? `${p.carpeta}/${id}.md` : `${p.carpeta}/${id}-${slug(p.titulo)}.md`;
  await guardia.rutaParaEscribir(ruta); // valida la carpeta ya, para avisar antes de confirmar

  const doc = new Document({
    id,
    project_id: cfg.project_id,
    type: p.tipo,
    schema: 1,
    title: p.titulo,
    ...p.propiedades,
    created: momento.fecha,
    updated: momento.fechaHora,
  });
  let cuerpo = rellenar(await cargarPlantilla(p.tipo, ctx.plantillas), p.valores, '\n');
  // cargarPlantilla ya garantizó los bloques del formato vigente: solo falta alguno en un formato anterior.
  for (const [nombre, contenido] of Object.entries(p.bloques ?? {})) {
    if (leerBloque(cuerpo, nombre) !== null) cuerpo = escribirBloque(cuerpo, nombre, contenido, '\n');
  }
  if (p.historial !== undefined && leerBloque(cuerpo, 'historial') !== null) {
    cuerpo = escribirBloque(cuerpo, 'historial', `- ${momento.legible} · ${p.historial} · ${p.herramienta}`, '\n');
  }
  ops.push({ tipo: 'crear', ruta, contenido: unirNota({ bom: false, eol: '\n', doc, cuerpo }) });
  return preparar(ctx, `crear ${id}`, ops);
}

// ——— Editar ———

export type Edicion = {
  herramienta: string;
  historial?: string; // línea que se agrega al historial; si viene, la nota debe tener ese bloque
  propiedades?: [string, unknown][]; // en orden; null como valor borra la propiedad
  bloques?: Record<string, string>; // bloques gestionados a reescribir; cada uno debe existir
  cuerpo?: (cuerpo: string, eol: string) => string; // excepción: cambios fuera de los bloques (agregar un criterio)
  avisos?: string[]; // avisos propios del llamador; encabezan la vista previa
};

// Prepara el reemplazo de una nota existente. Relee la nota: si ya no está en la versión del índice,
// no prepara nada. Solo cambia propiedades, bloques gestionados, «updated» y el historial; todo lo
// demás queda igual, byte a byte.
export async function editar(ctx: Contexto, guardia: Guardia, nota: Nota, e: Edicion): Promise<Preparado> {
  const cfg = ctx.config;
  const nombre = nota.id || nota.ruta;
  const leida = await guardia.leer(nota.ruta);
  if (leida.version !== nota.version) throw new ErrorMcp('CONFLICTO', `${nombre} cambió desde que la leíste: vuelve a leerla y a preparar el cambio.`);
  const sep = separarNota(leida.texto, cfg.limites.yaml_max_kb * 1024);
  const momento = ahora(cfg.zona_horaria);
  const avisos = [...(e.avisos ?? [])];

  // Antes de tocar nada: cada bloque pedido debe existir, y lo editado a mano se advierte (se va a pisar).
  const bloques = Object.entries(e.bloques ?? {});
  for (const [b] of bloques) {
    const bloque = leerBloque(sep.cuerpo, b);
    if (bloque === null) {
      throw new ErrorMcp('BLOQUE_FALTA', `${nombre} no tiene el bloque gestionado «${b}» (se creó a mano o con una plantilla sin bloques): edita esa sección a mano en Obsidian o agrégale sus marcadores.`);
    }
    if (bloque.editadoAMano) avisos.push(avisoEditadoAMano(b));
  }
  if (e.historial !== undefined && leerBloque(sep.cuerpo, 'historial') === null) {
    throw new ErrorMcp('BLOQUE_FALTA', `${nombre} no tiene el bloque de historial.`);
  }

  for (const [clave, valor] of e.propiedades ?? []) {
    if (valor === null) sep.doc.delete(clave);
    else sep.doc.set(clave, valor);
  }
  sep.doc.set('updated', momento.fechaHora);
  let cuerpo = e.cuerpo === undefined ? sep.cuerpo : e.cuerpo(sep.cuerpo, sep.eol);
  for (const [b, texto] of bloques) cuerpo = escribirBloque(cuerpo, b, texto, sep.eol);
  if (e.historial !== undefined) {
    const historial = leerBloque(cuerpo, 'historial');
    if (historial === null) throw new ErrorMcp('BLOQUE_FALTA', `${nombre} no tiene el bloque de historial.`);
    const linea = `- ${momento.legible} · ${e.historial} · ${e.herramienta}`;
    cuerpo = escribirBloque(cuerpo, 'historial', historial.contenido === '' ? linea : `${historial.contenido}${sep.eol}${linea}`, sep.eol);
    if (historial.editadoAMano) avisos.push('Aviso: el historial fue editado a mano; se agrega la línea igual y se renueva su huella.');
  }
  const contenido = unirNota({ bom: sep.bom, eol: sep.eol, doc: sep.doc, cuerpo });
  return preparar(ctx, `editar ${nombre}`, [{ tipo: 'reemplazar', ruta: nota.ruta, contenido, versionEsperada: leida.version, antes: leida.texto }], avisos);
}

// ——— Regenerar un bloque ———

// Reemplaza un bloque gestionado de una nota cualquiera del proyecto (p. ej. el tablero).
// Devuelve null si el bloque ya tiene ese contenido y nadie lo editó a mano: regenerar no cambia nada.
export async function regenerarBloque(ctx: Contexto, guardia: Guardia, ruta: string, nombre: string, texto: string): Promise<Preparado | null> {
  const cfg = ctx.config;
  const leida = await guardia.leer(ruta);
  const sep = separarNota(leida.texto, cfg.limites.yaml_max_kb * 1024);
  if (sep.datos.project_id !== cfg.project_id) throw new ErrorMcp('PROJECT_ID_AJENO', `${ruta} no pertenece a este proyecto.`);
  const bloque = leerBloque(sep.cuerpo, nombre);
  if (bloque === null) throw new ErrorMcp('BLOQUE_FALTA', `${ruta} no tiene el bloque «${nombre}».`);
  const igual = texto.replaceAll('\r\n', '\n') === bloque.contenido.replaceAll('\r\n', '\n');
  if (igual && !bloque.editadoAMano) return null;

  sep.doc.set('updated', ahora(cfg.zona_horaria).fechaHora);
  const cuerpo = escribirBloque(sep.cuerpo, nombre, texto, sep.eol);
  const contenido = unirNota({ bom: sep.bom, eol: sep.eol, doc: sep.doc, cuerpo });
  const avisos = bloque.editadoAMano ? [avisoEditadoAMano(nombre)] : [];
  return preparar(ctx, `regenerar ${nombre} de ${ruta}`, [{ tipo: 'reemplazar', ruta, contenido, versionEsperada: leida.version, antes: leida.texto }], avisos);
}
