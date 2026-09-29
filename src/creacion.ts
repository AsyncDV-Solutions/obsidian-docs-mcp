import { Document } from 'yaml';
import type { Contexto } from './arranque.ts';
import { escribirBloque } from './bloques.ts';
import { diffLineas, guardarCambio } from './confirmaciones.ts';
import type { Cambio } from './confirmaciones.ts';
import { ahora, slug } from './dominio.ts';
import type { TipoNumerado } from './dominio.ts';
import { ErrorMcp } from './errores.ts';
import { separarNota, unirNota } from './frontmatter.ts';
import type { Guardia, Leida } from './guardia.ts';
import { claveContador, formatearId, RUTA_CONTADORES, siguienteNumero } from './ids.ts';
import type { Indice } from './notas.ts';
import { cargarPlantilla, rellenar } from './plantillas.ts';
import type { TipoPlantilla } from './plantillas.ts';

export type Preparado = { cambio: Cambio; confirmacion: string; expira: Date; vistaPrevia: string };

// Enlace de Obsidian con la ruta completa dentro del vault: nunca es ambiguo.
export function enlace(ctx: Contexto, rutaNota: string, alias: string): string {
  return `[[${ctx.config.project_dir}/${rutaNota.replace(/\.md$/i, '')}|${alias}]]`;
}

// Convierte ids en enlaces. Cada id debe existir en el índice del proyecto.
export function enlacesA(ctx: Contexto, indice: Indice, ids: string[] | undefined): string[] {
  return (ids ?? []).map((id) => {
    const nota = indice.notas.find((n) => n.id === id);
    if (nota === undefined) throw new ErrorMcp('ID_DESCONOCIDO', `No existe una nota del proyecto con id ${id}.`);
    return enlace(ctx, nota.ruta, id);
  });
}

export type PedidoCreacion = {
  tipo: TipoNumerado & TipoPlantilla;
  carpeta: string; // relativa al proyecto, p. ej. 'Tareas' (config.carpetas). Debe existir
  titulo: string;
  propiedades: Record<string, unknown>; // las propias del tipo, en el orden deseado
  valores: Record<string, string>; // campos {{…}} de la plantilla
  bloques?: Record<string, string>; // contenido de bloques gestionados de la plantilla (se escriben con huella)
  historial?: string; // primera línea del historial, si la plantilla lo tiene
  herramienta: string;
};

// Prepara la creación de una nota numerada: contador + nota nueva, en un solo cambio.
export async function prepararCreacion(ctx: Contexto, guardia: Guardia, indice: Indice, p: PedidoCreacion): Promise<Preparado> {
  const cfg = ctx.config;
  const momento = ahora(cfg.zona_horaria);

  // 1. El contador: leer, calcular el siguiente número y preparar su reemplazo.
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
  const numero = siguienteNumero(p.tipo, cfg.id_prefix, sep.datos, indice.notas);
  const id = formatearId(cfg.id_prefix, p.tipo, numero);
  sep.doc.set(claveContador(p.tipo), numero);
  const contadoresNuevo = unirNota({ bom: sep.bom, eol: sep.eol, doc: sep.doc, cuerpo: sep.cuerpo });

  // 2. La nota: propiedades armadas por código (valores undefined se omiten) + cuerpo de la plantilla.
  const ruta = `${p.carpeta}/${id}-${slug(p.titulo)}.md`;
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
  for (const [nombre, contenido] of Object.entries(p.bloques ?? {})) {
    cuerpo = escribirBloque(cuerpo, nombre, contenido.replace(/\r?\n/g, '\n'), '\n');
  }
  if (p.historial !== undefined) {
    cuerpo = escribirBloque(cuerpo, 'historial', `- ${momento.legible} · ${p.historial} · ${p.herramienta}`, '\n');
  }
  const contenido = unirNota({ bom: false, eol: '\n', doc, cuerpo });

  const cambio: Cambio = {
    descripcion: `crear ${id}`,
    operaciones: [
      { tipo: 'reemplazar', ruta: RUTA_CONTADORES, contenido: contadoresNuevo, versionEsperada: contadores.version },
      { tipo: 'crear', ruta, contenido },
    ],
  };
  const { confirmacion, expira } = guardarCambio(cambio, cfg.limites.confirmacion_minutos);
  const vistaPrevia = [`Crear ${ruta}:`, '———', contenido, '———', `Actualizar ${RUTA_CONTADORES}:`, diffLineas(contadores.texto, contadoresNuevo)].join('\n');
  return { cambio, confirmacion, expira, vistaPrevia };
}
