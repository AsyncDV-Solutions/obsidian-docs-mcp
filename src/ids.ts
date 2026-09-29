// El id de una nota: cómo se ve, cómo se valida, los enlaces que lo nombran y el contador que lo reparte.
// Es el único lugar que conoce el formato; los esquemas de las herramientas, el índice, el tablero e
// iniciar lo derivan de acá (test/endurecimiento.test.ts lo exige).
import type { Nota } from './notas.ts';

// Letra de cada tipo numerado dentro del id, con el prefijo del proyecto: PRJ-T-0001, PRJ-F-0001,
// PRJ-I-0001, PRJ-ADR-0001 y PRJ-G-0001. Los releases no se numeran: su id lleva la versión (PRJ-R-v1.2.3).
export const LETRA = { tarea: 'T', funcionalidad: 'F', incidencia: 'I', decision: 'ADR', guia: 'G' } as const;
export type TipoNumerado = keyof typeof LETRA;

export const RUTA_CONTADORES = '_contadores.md';

const ER_PREFIJO = '[A-Z]{2,5}';
const ER_NUMERO = '\\d{4,}';
const ER_VERSION = '\\d+\\.\\d+\\.\\d+';
const LETRAS = Object.values(LETRA).join('|');

// El prefijo del proyecto (id_prefix): de 2 a 5 letras mayúsculas.
export const PATRON_PREFIJO = new RegExp(`^${ER_PREFIJO}$`);
export const PATRON_ID_RELEASE = new RegExp(`^${ER_PREFIJO}-R-v${ER_VERSION}$`);

// Un id de esos tipos con cualquier prefijo: lo usan los esquemas de las herramientas, que no conocen el
// prefijo del proyecto. Que el id exista en el proyecto lo comprueba el índice.
export function patronId(...tipos: TipoNumerado[]): RegExp {
  return new RegExp(`^${ER_PREFIJO}-(${tipos.map((t) => LETRA[t]).join('|')})-${ER_NUMERO}$`);
}

export function formatearId(prefijo: string, tipo: TipoNumerado, numero: number): string {
  return `${prefijo}-${LETRA[tipo]}-${String(numero).padStart(4, '0')}`;
}

export function idDeRelease(prefijo: string, version: string): string {
  return `${prefijo}-R-v${version}`;
}

// ¿El id tiene el formato de su tipo y el prefijo del proyecto? El marcador, los contadores y las
// referencias no llevan id.
export function idValido(id: string, tipo: string, prefijo: string): boolean {
  if (tipo === 'release') return new RegExp(`^${prefijo}-R-v${ER_VERSION}$`).test(id);
  if (Object.hasOwn(LETRA, tipo)) return new RegExp(`^${prefijo}-${LETRA[tipo as TipoNumerado]}-${ER_NUMERO}$`).test(id);
  return id === '';
}

// ——— Enlaces ———

// Lo único que un enlace necesita saber del proyecto: la carpeta donde vive dentro del vault.
export type Proyecto = { config: { project_dir: string } };

// Enlace de Obsidian con la ruta completa dentro del vault: nunca es ambiguo.
export function enlace(proyecto: Proyecto, rutaNota: string, alias: string): string {
  return `[[${proyecto.config.project_dir}/${rutaNota.replace(/\.md$/i, '')}|${alias}]]`;
}

const ID_EN_NOMBRE = new RegExp(`^(?:${ER_PREFIJO}-(?:${LETRAS})-${ER_NUMERO}|${ER_PREFIJO}-R-v${ER_VERSION})`);

// El id al que apunta un valor: un enlace [[…/ID-slug|alias]] o el texto tal cual. Si lo que nombra no es
// un id, devuelve el nombre.
export function idDeEnlace(valor: string): string {
  const destino = /^\[\[([^|\]]+)/.exec(valor)?.[1];
  if (destino === undefined) return valor;
  const nombre = destino.split('/').at(-1) ?? '';
  return ID_EN_NOMBRE.exec(nombre)?.[0] ?? nombre;
}

// ——— Contadores ———

export function claveContador(tipo: TipoNumerado): string {
  return `ultimo_${LETRA[tipo]}`;
}

// Contenido inicial de _contadores.md: un contador en cero por tipo numerado, en el orden de las letras.
export function contadoresIniciales(): Record<string, number> {
  return Object.fromEntries((Object.keys(LETRA) as TipoNumerado[]).map((tipo) => [claveContador(tipo), 0]));
}

// Siguiente número: nunca menor que el contador guardado ni que el mayor ID existente.
// Así ningún número se reutiliza, aunque borres a mano la última nota.
export function siguienteNumero(tipo: TipoNumerado, prefijo: string, contadores: Record<string, unknown>, notas: Nota[]): number {
  const guardado = contadores[claveContador(tipo)];
  const patron = new RegExp(`^${prefijo}-${LETRA[tipo]}-(${ER_NUMERO})$`);
  let mayor = 0;
  for (const n of notas) {
    const m = patron.exec(n.id);
    if (m !== null) mayor = Math.max(mayor, Number(m[1]));
  }
  return Math.max(typeof guardado === 'number' ? guardado : 0, mayor) + 1;
}
