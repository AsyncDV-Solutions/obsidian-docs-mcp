// Cambios preparados: el único módulo que arma el contenido nuevo de una nota y lo deja listo
// para aplicar. Un cambio preparado no escribe nada: devuelve una vista previa y un código de
// confirmación de un solo uso que aplicar.ts consume.
//
// Invariantes que viven acá y en ningún otro lado:
//   - La vista previa se genera desde las operaciones: la persona aprueba exactamente lo que se escribe.
//   - Toda operación de reemplazo va atada a la versión releída de la nota (concurrencia optimista).
//   - BOM y saltos de línea de la nota se conservan; «updated» se renueva en cada edición.
//   - Crear una nota numerada reemplaza _contadores.md atado a su versión: aplicar una creación
//     invalida las otras vistas previas de creación (nunca se reparte un número dos veces).
//   - El código lo guarda el almacén de la sesión (almacen.ts): vence y sirve una sola vez.
import { Document } from 'yaml';
import { escribirBloque, leerBloque } from './bloques.ts';
import { ahora, slug } from './dominio.ts';
import { ErrorMcp } from './errores.ts';
import { separarNota, unirNota } from './frontmatter.ts';
import type { NotaSeparada } from './frontmatter.ts';
import type { Leida } from './guardia.ts';
import { claveContador, formatearId, RUTA_CONTADORES, siguienteNumero } from './ids.ts';
import type { Indice, Nota } from './notas.ts';
import { cargarPlantilla, rellenar } from './plantillas.ts';
import type { Sesion } from './sesion.ts';
import { TIPOS_DE_NOTA } from './tipos.ts';
import type { TipoDeNota, TipoNumerado } from './tipos.ts';

// Un reemplazo recuerda el texto que reemplaza (antes): la vista previa muestra su diff.
export type Operacion =
  | { tipo: 'crear'; ruta: string; contenido: string }
  | { tipo: 'reemplazar'; ruta: string; contenido: string; versionEsperada: string; antes: string };

// Las propiedades de una nota, en el orden en que se escriben. undefined: sin valor (al crear se omite, al editar no se
// toca). null: quitar la propiedad, que solo tiene sentido al editar.
export type Propiedades = Record<string, unknown>;

// Las claves que traen valor, incluido null: lo que un cambio toca. Sirve para decirlo en el historial.
export function clavesConValor(propiedades: Propiedades): string[] {
  return Object.entries(propiedades).filter(([, valor]) => valor !== undefined).map(([clave]) => clave);
}

export type Cambio = { descripcion: string; operaciones: Operacion[] };

export type Preparado = { confirmacion: string; minutos: number; vistaPrevia: string };

// ——— Vista previa ———

// Diff de líneas: solo los cambios, con dos líneas de contexto.
function diffLineas(antes: string, despues: string): string {
  const a = antes.split(/\r?\n/);
  const b = despues.split(/\r?\n/);
  if (a.length * b.length > 1_000_000) return '(nota demasiado grande para un diff: revisa el contenido completo)';
  // lcs[i][j] = largo de la subsecuencia común más larga entre a[i..] y b[j..]
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const lineas: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      lineas.push(`  ${a[i]}`);
      i++;
      j++;
    } else if (i < a.length && (j >= b.length || lcs[i + 1][j] >= lcs[i][j + 1])) {
      lineas.push(`- ${a[i]}`);
      i++;
    } else {
      lineas.push(`+ ${b[j]}`);
      j++;
    }
  }
  const cambia = lineas.map((l) => !l.startsWith('  '));
  const salida: string[] = [];
  let omitiendo = false;
  lineas.forEach((l, k) => {
    if (cambia.slice(Math.max(0, k - 2), k + 3).some(Boolean)) {
      salida.push(l);
      omitiendo = false;
    } else if (!omitiendo) {
      salida.push('  …');
      omitiendo = true;
    }
  });
  return salida.join('\n');
}

// Registra el cambio y arma la vista previa: avisos primero, después las notas nuevas completas y al
// final los diffs de las reemplazadas. Las operaciones se aplican en el orden recibido, no en este.
function preparar(sesion: Sesion, descripcion: string, ops: Operacion[], avisos: string[] = []): Preparado {
  const cambio: Cambio = { descripcion, operaciones: ops };
  const paraLeer = [...ops.filter((op) => op.tipo === 'crear'), ...ops.filter((op) => op.tipo === 'reemplazar')];
  const cuerpo = paraLeer.map((op) => (op.tipo === 'crear' ? `Crear ${op.ruta}:\n———\n${op.contenido}\n———` : `Cambios en ${op.ruta}:\n${diffLineas(op.antes, op.contenido)}`));
  const { confirmacion, minutos } = sesion.almacen.guardar(cambio);
  return { confirmacion, minutos, vistaPrevia: [...avisos, ...cuerpo].join('\n') };
}

function avisoEditadoAMano(nombre: string): string {
  return `ATENCIÓN: el bloque «${nombre}» fue editado a mano; al aplicar se pierden esos cambios.`;
}

function lineaHistorial(momento: { legible: string }, texto: string, herramienta: string): string {
  return `- ${momento.legible} · ${texto} · ${herramienta}`;
}

// ——— Crear ———

type PedidoBase = {
  titulo: string;
  propiedades: Propiedades; // las propias del tipo, en el orden deseado; sin valor (undefined o null) se omite
  valores: Record<string, string>; // campos {{…}} de la plantilla
  // Contenido de los bloques gestionados (se escriben con huella). Una plantilla propia en un formato
  // anterior no trae esos bloques: ese contenido entra por sus campos {{…}} y el bloque se omite.
  bloques?: Record<string, string>;
  historial?: string; // primera línea del historial, si la plantilla lo tiene
  herramienta: string;
};

// La carpeta la dice la declaración del tipo, que debe existir en el vault. Un tipo numerado (PRJ-T-0001, archivo
// «<id>-<slug>.md») recibe su id de los contadores; el que no se numera trae el suyo (PRJ-R-v1.0.0, archivo «<id>.md»).
export type PedidoCrear = PedidoBase & ({ tipo: TipoNumerado; id?: undefined } | { tipo: Exclude<TipoDeNota, TipoNumerado>; id: string });

// El contador: leer, validar, calcular el siguiente número y preparar su reemplazo.
async function numerar(sesion: Sesion, indice: Indice, tipo: TipoNumerado): Promise<{ id: string; op: Operacion }> {
  const cfg = sesion.config;
  let contadores: Leida;
  try {
    contadores = await sesion.guardia.leer(RUTA_CONTADORES);
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
// Que el archivo destino ya exista lo detecta aplicar (YA_EXISTE): acá solo se valida la carpeta.
export async function crear(sesion: Sesion, indice: Indice, pedido: PedidoCrear): Promise<Preparado> {
  const cfg = sesion.config;
  const momento = ahora(cfg.zona_horaria);
  const ops: Operacion[] = [];
  const carpeta = cfg.carpetas[TIPOS_DE_NOTA[pedido.tipo].carpeta];
  let id: string;
  if (pedido.id === undefined) {
    ({ id, op: ops[0] } = await numerar(sesion, indice, pedido.tipo));
  } else {
    id = pedido.id;
  }
  const ruta = pedido.id === undefined ? `${carpeta}/${id}-${slug(pedido.titulo)}.md` : `${carpeta}/${id}.md`;
  await sesion.guardia.rutaParaEscribir(ruta); // valida la carpeta ya, para avisar antes de confirmar

  const doc = new Document({
    id,
    project_id: cfg.project_id,
    type: pedido.tipo,
    schema: 1,
    title: pedido.titulo,
    ...Object.fromEntries(Object.entries(pedido.propiedades).filter(([, valor]) => valor !== undefined && valor !== null)),
    created: momento.fecha,
    updated: momento.fechaHora,
  });
  let cuerpo = rellenar(await cargarPlantilla(pedido.tipo, sesion.plantillas), pedido.valores, '\n');
  // cargarPlantilla ya garantizó los bloques del formato vigente: solo falta alguno en un formato anterior.
  for (const [nombre, contenido] of Object.entries(pedido.bloques ?? {})) {
    if (leerBloque(cuerpo, nombre) !== null) cuerpo = escribirBloque(cuerpo, nombre, contenido, '\n');
  }
  if (pedido.historial !== undefined && leerBloque(cuerpo, 'historial') !== null) {
    cuerpo = escribirBloque(cuerpo, 'historial', lineaHistorial(momento, pedido.historial, pedido.herramienta), '\n');
  }
  ops.push({ tipo: 'crear', ruta, contenido: unirNota({ bom: false, eol: '\n', doc, cuerpo }) });
  return preparar(sesion, `crear ${id}`, ops);
}

// ——— Reemplazar una nota existente ———

type Abierta = { leida: Leida; sep: NotaSeparada; momento: ReturnType<typeof ahora> };

// Lo primero que hacen editar y regenerarBloque: leer la nota y separar sus propiedades del cuerpo. verificar
// corre antes de interpretar nada, con lo leído.
async function abrir(sesion: Sesion, ruta: string, verificar?: (leida: Leida) => void): Promise<Abierta> {
  const leida = await sesion.guardia.leer(ruta);
  verificar?.(leida);
  const sep = separarNota(leida.texto, sesion.config.limites.yaml_max_kb * 1024);
  return { leida, sep, momento: ahora(sesion.config.zona_horaria) };
}

// Lo último: renueva «updated» y prepara el reemplazo de la nota con su cuerpo nuevo, conservando el BOM y los saltos
// de línea. Las propiedades que el llamador haya tocado en sep.doc ya están puestas.
function cerrar(sesion: Sesion, descripcion: string, abierta: Abierta, cuerpo: string, avisos: string[]): Preparado {
  const { leida, sep, momento } = abierta;
  sep.doc.set('updated', momento.fechaHora);
  const contenido = unirNota({ bom: sep.bom, eol: sep.eol, doc: sep.doc, cuerpo });
  return preparar(sesion, descripcion, [{ tipo: 'reemplazar', ruta: leida.ruta, contenido, versionEsperada: leida.version, antes: leida.texto }], avisos);
}

// ——— Editar ———

export type Edicion = {
  herramienta: string;
  historial?: string; // línea que se agrega al historial; si viene, la nota debe tener ese bloque
  propiedades?: Propiedades; // undefined no la toca y null la quita
  bloques?: Record<string, string>; // bloques gestionados a reescribir; cada uno debe existir
  cuerpo?: (cuerpo: string, eol: string) => string; // excepción: cambios fuera de los bloques (agregar un criterio)
};

// Prepara el reemplazo de una nota existente. Relee la nota: si ya no está en la versión del índice,
// no prepara nada. Solo cambia propiedades, bloques gestionados, «updated», el cuerpo que pida el
// llamador y el historial, en ese orden; todo lo demás queda igual, byte a byte.
export async function editar(sesion: Sesion, nota: Nota, edicion: Edicion): Promise<Preparado> {
  const nombre = nota.id || nota.ruta;
  const abierta = await abrir(sesion, nota.ruta, (leida) => {
    if (leida.version !== nota.version) throw new ErrorMcp('CONFLICTO', `${nombre} cambió desde que la leíste: vuelve a leerla y a preparar el cambio.`);
  });
  const { sep, momento } = abierta;
  const avisos: string[] = [];

  // Antes de tocar nada: cada bloque pedido debe existir, y lo editado a mano se advierte (se va a pisar).
  const bloques = Object.entries(edicion.bloques ?? {});
  for (const [b] of bloques) {
    const bloque = leerBloque(sep.cuerpo, b);
    if (bloque === null) {
      throw new ErrorMcp('BLOQUE_FALTA', `${nombre} no tiene el bloque gestionado «${b}» (se creó a mano o con una plantilla sin bloques): edita ese bloque a mano en Obsidian o agrégale sus marcadores.`);
    }
    if (bloque.editadoAMano) avisos.push(avisoEditadoAMano(b));
  }

  for (const [clave, valor] of Object.entries(edicion.propiedades ?? {})) {
    if (valor === undefined) continue;
    if (valor === null) sep.doc.delete(clave);
    else sep.doc.set(clave, valor);
  }
  let cuerpo = sep.cuerpo;
  for (const [b, texto] of bloques) cuerpo = escribirBloque(cuerpo, b, texto, sep.eol);
  if (edicion.cuerpo !== undefined) cuerpo = edicion.cuerpo(cuerpo, sep.eol);
  if (edicion.historial !== undefined) {
    const historial = leerBloque(cuerpo, 'historial');
    if (historial === null) throw new ErrorMcp('BLOQUE_FALTA', `${nombre} no tiene el bloque de historial.`);
    const linea = lineaHistorial(momento, edicion.historial, edicion.herramienta);
    cuerpo = escribirBloque(cuerpo, 'historial', historial.contenido === '' ? linea : `${historial.contenido}${sep.eol}${linea}`, sep.eol);
    if (historial.editadoAMano) avisos.push('Aviso: el historial fue editado a mano; se agrega la línea igual y se renueva su huella.');
  }
  return cerrar(sesion, `editar ${nombre}`, abierta, cuerpo, avisos);
}

// ——— Regenerar un bloque ———

// Reemplaza un bloque gestionado de una nota cualquiera del proyecto (p. ej. el tablero).
// Devuelve null si el bloque ya tiene ese contenido y nadie lo editó a mano: regenerar no cambia nada.
export async function regenerarBloque(sesion: Sesion, ruta: string, nombre: string, texto: string): Promise<Preparado | null> {
  const abierta = await abrir(sesion, ruta);
  const { sep } = abierta;
  if (sep.datos.project_id !== sesion.config.project_id) throw new ErrorMcp('PROJECT_ID_AJENO', `${ruta} no pertenece a este proyecto.`);
  const bloque = leerBloque(sep.cuerpo, nombre);
  if (bloque === null) throw new ErrorMcp('BLOQUE_FALTA', `${ruta} no tiene el bloque «${nombre}».`);
  const igual = texto.replaceAll('\r\n', '\n') === bloque.contenido.replaceAll('\r\n', '\n');
  if (igual && !bloque.editadoAMano) return null;

  const cuerpo = escribirBloque(sep.cuerpo, nombre, texto, sep.eol);
  const avisos = bloque.editadoAMano ? [avisoEditadoAMano(nombre)] : [];
  return cerrar(sesion, `regenerar ${nombre} de ${ruta}`, abierta, cuerpo, avisos);
}
