import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { leerBloque } from './bloques.ts';
import { ErrorMcp } from './errores.ts';

// Plantillas del MCP: viven en plantillas/ del repo del MCP, no en el vault. Con plantillas_dir
// puedes usar las tuyas: cada una que falte ahí se toma de plantillas/.
// Solo tienen el CUERPO de la nota; las propiedades las arma el código para garantizar el esquema.
const CARPETA = fileURLToPath(new URL('../plantillas/', import.meta.url));

// Campos {{así}} que cada plantilla debe usar, y bloques gestionados que debe traer.
export const PLANTILLAS = {
  tarea: { campos: ['descripcion', 'criterios'], bloques: ['historial'] },
  // Versión 1.2.0: el contenido va en bloques gestionados para que funcionalidad_actualizar pueda reescribirlo.
  funcionalidad: { campos: [], bloques: ['que_hace', 'afirmaciones', 'pendientes', 'historial'] },
  incidencia: { campos: ['sintoma', 'impacto', 'causa'], bloques: ['historial'] },
  decision: { campos: ['contexto', 'decision', 'alternativas', 'consecuencias'], bloques: [] },
  release: { campos: [], bloques: ['release'] }, // su contenido lo genera el código dentro del bloque
  guia: { campos: ['proposito', 'pasos', 'problemas', 'afirmaciones', 'pendientes'], bloques: [] }, // versión 1.1.0
} as const;
export type TipoPlantilla = keyof typeof PLANTILLAS;

const cache = new Map<string, string>();

// Texto de la plantilla propia, o null si no hay una para ese tipo.
async function leerPropia(dir: string, tipo: TipoPlantilla): Promise<string | null> {
  const ruta = path.join(dir, `${tipo}.md`);
  const info = await lstat(ruta).catch(() => null);
  if (info === null) return null;
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new ErrorMcp('PLANTILLA_ENLACE', `La plantilla propia ${tipo}.md no es un archivo normal (¿es un enlace?).`);
  }
  return readFile(ruta, 'utf8');
}

// dirPropio: la carpeta real de plantillas_dir (ya validada al arrancar), o null.
export async function cargarPlantilla(tipo: TipoPlantilla, dirPropio: string | null = null): Promise<string> {
  const clave = `${dirPropio ?? ''}|${tipo}`;
  const guardada = cache.get(clave);
  if (guardada !== undefined) return guardada;
  const propia = dirPropio === null ? null : await leerPropia(dirPropio, tipo);
  const origen = propia === null ? `plantillas/${tipo}.md del MCP` : `${tipo}.md de plantillas_dir`;
  let texto: string;
  try {
    texto = propia ?? (await readFile(`${CARPETA}${tipo}.md`, 'utf8'));
  } catch {
    throw new ErrorMcp('PLANTILLA_FALTA', `Falta la plantilla plantillas/${tipo}.md en el repo del MCP.`);
  }
  const campos: readonly string[] = PLANTILLAS[tipo].campos;
  const bloques: readonly string[] = PLANTILLAS[tipo].bloques;
  const usados = [...texto.matchAll(/\{\{([a-z_]+)\}\}/g)].map((m) => m[1] ?? '');
  const faltan = [...campos.filter((c) => !usados.includes(c)), ...bloques.filter((b) => leerBloque(texto, b) === null)];
  const sobran = usados.filter((c) => !campos.includes(c));
  if (faltan.length > 0 || sobran.length > 0) {
    throw new ErrorMcp('PLANTILLA_INVALIDA', `La plantilla ${origen} no calza: faltan [${faltan.join(', ')}], sobran [${sobran.join(', ')}].`);
  }
  cache.set(clave, texto);
  return texto;
}

// Rellena los campos en UNA pasada (un valor nunca se vuelve a interpretar) y usa los saltos pedidos.
export function rellenar(plantilla: string, valores: Record<string, string>, eol: string): string {
  return plantilla.replace(/\{\{([a-z_]+)\}\}/g, (_, campo: string) => valores[campo] ?? '').replace(/\r?\n/g, eol);
}
