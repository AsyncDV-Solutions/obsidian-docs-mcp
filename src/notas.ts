import type { Config } from './config.ts';
import { normalizar, PRIORIDADES, TIPOS } from './dominio.ts';
import { ErrorMcp } from './errores.ts';
import { separarNota } from './frontmatter.ts';
import type { Guardia, Leida } from './guardia.ts';
import { enlace, idDeEnlace, idValido } from './ids.ts';

export type Nota = {
  ruta: string; // relativa a la carpeta del proyecto
  version: string;
  id: string; // '' si el tipo no lleva id
  tipo: string;
  titulo: string;
  datos: Record<string, unknown>;
  cuerpo: string;
};

export type Anomalia = { ruta: string; problema: string };
export type Indice = { notas: Nota[]; anomalias: Anomalia[]; truncado: boolean };

export async function indexar(guardia: Guardia, config: Config): Promise<Indice> {
  const { rutas, truncado } = await guardia.listar();
  const notas: Nota[] = [];
  const anomalias: Anomalia[] = [];
  const porId = new Map<string, string>();

  for (const ruta of rutas) {
    const anotar = (problema: string): void => {
      anomalias.push({ ruta, problema });
    };
    let leida: Leida;
    let datos: Record<string, unknown>;
    let cuerpo: string;
    try {
      leida = await guardia.leer(ruta);
      ({ datos, cuerpo } = separarNota(leida.texto, config.limites.yaml_max_kb * 1024));
    } catch (error) {
      anotar(error instanceof ErrorMcp ? error.codigo : 'LECTURA');
      continue;
    }
    if (!('project_id' in datos)) {
      anotar('SIN_PROJECT_ID');
      continue;
    }
    if (datos.project_id !== config.project_id) {
      anotar('PROJECT_ID_AJENO'); // se reporta; nunca se reasigna
      continue;
    }
    const tipo = typeof datos.type === 'string' ? datos.type : '';
    if (!(TIPOS as readonly string[]).includes(tipo)) {
      anotar('TIPO_DESCONOCIDO');
      continue;
    }
    const id = typeof datos.id === 'string' ? datos.id : '';
    if (!idValido(id, tipo, config.id_prefix)) {
      anotar('ID_INVALIDO');
      continue;
    }
    if (id !== '') {
      if (porId.has(id)) {
        anotar(`ID_DUPLICADO:${id}`);
        continue;
      }
      porId.set(id, ruta);
    }
    const titulo = typeof datos.title === 'string' ? datos.title : '';
    notas.push({ ruta, version: leida.version, id, tipo, titulo, datos, cuerpo });
  }
  return { notas, anomalias, truncado };
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

// Convierte ids en enlaces. Cada id debe existir en el índice del proyecto.
export function enlacesA(dirProyecto: string, indice: Indice, ids: string[] | undefined): string[] {
  return (ids ?? []).map((id) => {
    const nota = indice.notas.find((n) => n.id === id);
    if (nota === undefined) throw new ErrorMcp('ID_DESCONOCIDO', `No existe una nota del proyecto con id ${id}.`);
    return enlace(dirProyecto, nota.ruta, id);
  });
}

// El estado de una nota: status en tareas e incidencias, decision_status en decisiones y release_status en
// releases. Las demás notas no tienen.
export function estadoDe(nota: Nota): string {
  return String(nota.datos.status ?? nota.datos.decision_status ?? nota.datos.release_status ?? '');
}

// Lee una nota del proyecto por su ruta. La guardia valida la ruta y el tamaño; el project_id evita entregar la
// nota de otro proyecto.
export async function leerNotaDelProyecto(guardia: Guardia, config: Config, relativa: string): Promise<Leida> {
  const leida = await guardia.leer(relativa);
  const { datos } = separarNota(leida.texto, config.limites.yaml_max_kb * 1024);
  if (datos.project_id !== config.project_id) throw new ErrorMcp('PROJECT_ID_AJENO', `${leida.ruta} no pertenece a este proyecto.`);
  return leida;
}

export type Filtros = {
  tipo?: string;
  estado?: string;
  prioridad?: string;
  area?: string;
  release?: string; // id del release, p. ej. PRJ-R-v1.0.0
  bloqueadas?: boolean;
  depende_de?: string; // id que aparece en blocked_by
};

// Una propiedad puede ser un texto o una lista: siempre se trabaja como lista de textos.
export function comoLista(valor: unknown): string[] {
  if (Array.isArray(valor)) return valor.filter((v): v is string => typeof v === 'string');
  return typeof valor === 'string' ? [valor] : [];
}

// ¿La propiedad menciona el id, como texto o como enlace [[…/ID-slug|alias]]?
export function mencionaId(valor: unknown, id: string): boolean {
  return comoLista(valor).some((v) => idDeEnlace(v) === id);
}

export function filtrar(indice: Indice, f: Filtros): Nota[] {
  return indice.notas.filter(
    (n) =>
      (f.tipo === undefined || n.tipo === f.tipo) &&
      (f.estado === undefined || n.datos.status === f.estado) &&
      (f.prioridad === undefined || n.datos.priority === f.prioridad) &&
      (f.area === undefined || comoLista(n.datos.area).includes(f.area)) &&
      (f.release === undefined || mencionaId(n.datos.release, f.release)) &&
      (f.bloqueadas === undefined || (n.datos.status === 'Bloqueado') === f.bloqueadas) &&
      (f.depende_de === undefined || mencionaId(n.datos.blocked_by, f.depende_de)),
  );
}

export function ordenPorPrioridad(a: Nota, b: Nota): number {
  const rango = (n: Nota): number => {
    const i = (PRIORIDADES as readonly string[]).indexOf(String(n.datos.priority));
    return i === -1 ? 9 : i;
  };
  return rango(a) - rango(b) || a.id.localeCompare(b.id);
}

export type Coincidencia = { id: string; ruta: string; titulo: string; fragmento: string };

// El fragmento sale normalizado (en minúsculas y sin tildes): es corto y solo sirve de orientación.
export function buscar(indice: Indice, texto: string, f: Filtros, max: number): Coincidencia[] {
  const aguja = normalizar(texto);
  const salida: Coincidencia[] = [];
  for (const n of filtrar(indice, f)) {
    const enTitulo = normalizar(n.titulo).includes(aguja);
    const cuerpo = normalizar(n.cuerpo);
    const pos = cuerpo.indexOf(aguja);
    if (!enTitulo && pos === -1) continue;
    const fragmento = pos === -1 ? '' : cuerpo.slice(Math.max(0, pos - 60), pos + aguja.length + 60);
    salida.push({ id: n.id, ruta: n.ruta, titulo: n.titulo, fragmento });
    if (salida.length >= max) break;
  }
  return salida;
}
