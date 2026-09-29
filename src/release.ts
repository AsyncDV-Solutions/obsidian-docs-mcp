import type { Contexto } from './arranque.ts';
import type { Sesion } from './sesion.ts';
import { crear, editar } from './cambios.ts';
import type { Preparado, Propiedades } from './cambios.ts';
import { nombreProyecto } from './config.ts';
import { ahora, limpiarTextoLibre } from './dominio.ts';
import { ErrorMcp } from './errores.ts';
import type { Commit } from './git.ts';
import { idDeRelease } from './ids.ts';
import { divergencia as calcularDivergencia } from './repo.ts';
import type { Divergencia } from './repo.ts';

export type Bump = 'major' | 'minor' | 'patch' | 'ninguno' | 'linea-base';
export type Clasificacion = { major: Commit[]; minor: Commit[]; patch: Commit[]; otros: Commit[]; noConvencionales: Commit[] };

const CONVENCIONAL = /^([a-z]+)(\([^)]*\))?(!)?: \S/;

// Conventional Commits: fix → PATCH, feat → MINOR, "!" o BREAKING CHANGE → MAJOR. Son señales, no reglas.
export function clasificar(commits: Commit[]): Clasificacion {
  const c: Clasificacion = { major: [], minor: [], patch: [], otros: [], noConvencionales: [] };
  for (const commit of commits) {
    const m = CONVENCIONAL.exec(commit.asunto);
    if (m === null) c.noConvencionales.push(commit);
    else if (m[3] === '!' || /^BREAKING[ -]CHANGE: /m.test(commit.cuerpo)) c.major.push(commit);
    else if (m[1] === 'feat') c.minor.push(commit);
    else if (m[1] === 'fix') c.patch.push(commit);
    else c.otros.push(commit);
  }
  return c;
}

type Version = [number, number, number];

function leerVersion(tag: string): Version | null {
  const m = /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag);
  return m === null ? null : [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function ultimoTag(tags: string[]): string | null {
  const validos = tags
    .map((tag) => ({ tag, v: leerVersion(tag) }))
    .filter((x): x is { tag: string; v: Version } => x.v !== null)
    .sort((a, b) => b.v[0] - a.v[0] || b.v[1] - a.v[1] || b.v[2] - a.v[2]);
  return validos[0]?.tag ?? null;
}

export function siguienteVersion(base: string | null, bump: Bump): string {
  const v = base === null ? null : leerVersion(base);
  if (v === null || bump === 'linea-base') return '1.0.0';
  if (bump === 'major') return `${v[0] + 1}.0.0`;
  if (bump === 'minor') return `${v[0]}.${v[1] + 1}.0`;
  if (bump === 'patch') return `${v[0]}.${v[1]}.${v[2] + 1}`;
  return `${v[0]}.${v[1]}.${v[2]}`;
}

// Lista de verificación antes del tag (release.lista_verificacion). {head} se reemplaza por el commit.
export function listaVerificacion(ctx: Contexto, head: string): string[] {
  const lista = ctx.config.release.lista_verificacion.map((item) => `- [ ] ${item.replaceAll('{head}', head)}`);
  const d = ctx.config.release.rama_desarrollo;
  if (d !== undefined) lista.push(`- [ ] Revisaste la divergencia entre ${ctx.config.release.rama_principal} y ${d}`);
  return lista;
}

// Comandos sugeridos para etiquetar. El MCP nunca los ejecuta.
export function comandosTag(ctx: Contexto, version: string, ref: string): string[] {
  return [`    git tag -a v${version} ${ref} -m "${nombreProyecto(ctx.config)} v${version}"`, `    git push origin v${version}`];
}

export type Propuesta = {
  head: string;
  base: string | null;
  bump: Bump;
  version: string;
  motivos: string[]; // señales que justifican el bump, para que las revises
  clasificacion: Clasificacion | null;
  divergencia: Divergencia | null;
  avisos: string[]; // cosas que revisar antes del tag que no son señales para el bump
};

// La rama principal va por delante de la de desarrollo: un merge --ff-only de desarrollo a principal fallará.
function avisosDeDivergencia(d: Divergencia | null): string[] {
  if (d === null || d.principalNoEnDesarrollo <= 0) return [];
  return [`${d.principal} va por delante de ${d.desarrollo}: un merge --ff-only de ${d.desarrollo} a ${d.principal} fallará. Revísalo antes del tag.`];
}

export async function proponer(ctx: Contexto, headRef: string): Promise<Propuesta> {
  const git = ctx.consultasGit;
  const head = await git.resolver(headRef);
  const base = ultimoTag(await git.tagsDeVersion());
  const divergencia = await calcularDivergencia(ctx);
  const avisos = avisosDeDivergencia(divergencia);
  if (base === null) {
    const motivos = ['No hay tags v*: se propone la línea base v1.0.0 en el próximo release que cumpla la lista de verificación.'];
    return { head, base, bump: 'linea-base', version: '1.0.0', motivos, clasificacion: null, divergencia, avisos };
  }

  const commits = await git.commitsEntre(base, head);
  const c = clasificar(commits);
  const archivos = await git.archivosCambiados(base, head);

  const motivos: string[] = [];
  let bump: Bump = commits.length === 0 ? 'ninguno' : 'patch';
  if (c.minor.length > 0) bump = 'minor';
  if (c.major.length > 0) {
    bump = 'major';
    motivos.push(`${c.major.length} commit(s) marcados como incompatibles (! o BREAKING CHANGE).`);
  }
  // Migraciones destructivas (release.migraciones): una migración nueva con el marcador sube a major.
  const migraciones = ctx.config.release.migraciones;
  if (migraciones?.marcador_destructivo !== undefined) {
    const marcadas = (await git.archivosConMarcador(head, migraciones.marcador_destructivo, migraciones.carpeta)).filter((ruta) => archivos.includes(ruta));
    if (marcadas.length > 0) {
      bump = 'major';
      motivos.push(`Migraciones marcadas como destructivas: ${marcadas.join(', ')}.`);
    }
  }
  // Señales propias del proyecto (release.senales): si cambió algo bajo ese prefijo, se avisa.
  for (const senal of ctx.config.release.senales) {
    if (archivos.some((a) => a.startsWith(senal.prefijo)) && !motivos.includes(senal.mensaje)) motivos.push(senal.mensaje);
  }
  if (c.noConvencionales.length > 0) motivos.push(`${c.noConvencionales.length} commit(s) no siguen Conventional Commits: revísalos a mano.`);
  return { head, base, bump, version: siguienteVersion(base, bump), motivos, clasificacion: c, divergencia, avisos };
}

// ——— Borrador de notas de release ———

const SECCIONES = { anadido: 'Añadido', cambiado: 'Cambiado', obsoleto: 'Obsoleto', eliminado: 'Eliminado', corregido: 'Corregido', seguridad: 'Seguridad' } as const;
export type ClaveSeccion = keyof typeof SECCIONES;

export type DatosRelease = {
  version: string;
  titulo: string;
  resumen: string;
  secciones: Partial<Record<ClaveSeccion, string[]>>;
  migraciones: string[];
  bump: string;
  base_ref: string;
  head_ref: string;
  release_status: 'Borrador' | 'Lista' | 'Publicada';
  promotion_run?: string;
  fuentes: string[];
  version_esperada?: string;
};

// Contenido del bloque «release»: resumen, los 6 tipos de Keep a Changelog, migraciones, verificación y comandos.
export function contenidoRelease(ctx: Contexto, datos: DatosRelease): string {
  const lista = (items: string[] | undefined, vacio: string): string[] => (items === undefined || items.length === 0 ? [vacio] : items.map((i) => `- ${i}`));
  const lineas = ['## Resumen', datos.resumen, ''];
  for (const clave of Object.keys(SECCIONES) as ClaveSeccion[]) {
    lineas.push(`## ${SECCIONES[clave]}`, ...lista(datos.secciones[clave], '(nada)'), '');
  }
  lineas.push('## Migraciones de base de datos', ...lista(datos.migraciones, '(ninguna)'), '');
  lineas.push('## Verificación antes del tag', ...listaVerificacion(ctx, datos.head_ref), '');
  lineas.push('## Comandos sugeridos (los ejecutas tú, después de verificar)', ...comandosTag(ctx, datos.version, datos.head_ref));
  return lineas.join('\n');
}

// Crea o actualiza <carpetas.releases>/<prefijo>-R-v<versión>.md. Al actualizar, solo cambian las propiedades y el bloque.
export async function prepararBorradorRelease(sesion: Sesion, sinLimpiar: DatosRelease): Promise<Preparado> {
  const cfg = sesion.config;
  const datos = limpiarTextoLibre(sinLimpiar, cfg.limites.campo_max_kb);
  const indice = await sesion.indice();
  const id = idDeRelease(cfg.id_prefix, datos.version);
  const tagExiste = await sesion.consultasGit.existeTag(`v${datos.version}`);
  if (datos.release_status === 'Publicada' && !tagExiste) {
    throw new ErrorMcp('TAG_NO_VERIFICADO', `No veo el tag v${datos.version} en tu repo local: «Publicada» exige que exista.`);
  }
  const bloque = contenidoRelease(sesion, datos);
  const propiedades: Propiedades = {
    version: datos.version,
    proposed_tag: `v${datos.version}`,
    release_status: datos.release_status,
    bump: datos.bump,
    base_ref: datos.base_ref,
    head_ref: datos.head_ref,
    analyzed_on: ahora(cfg.zona_horaria).fecha,
    tag_verified: tagExiste,
    promotion_run: datos.promotion_run,
    source: datos.fuentes,
  };

  const existente = indice.notas.find((n) => n.id === id);
  if (existente === undefined) {
    return crear(sesion, indice, {
      tipo: 'release',
      id, // los releases no se numeran: el id lleva la versión
      titulo: datos.titulo,
      propiedades,
      valores: {},
      bloques: { release: bloque },
      herramienta: 'release_borrador_guardar',
    });
  }
  if (datos.version_esperada !== existente.version) {
    throw new ErrorMcp('CONFLICTO', `${id} ya existe: léelo con nota_leer y pasa su versión en version_esperada.`);
  }
  // Sin historial: la plantilla de release no lo tiene. Una propiedad sin valor (promotion_run) se quita.
  const cambios: Propiedades = { title: datos.titulo, ...Object.fromEntries(Object.entries(propiedades).map(([clave, valor]) => [clave, valor ?? null])) };
  return editar(sesion, existente, { herramienta: 'release_borrador_guardar', propiedades: cambios, bloques: { release: bloque } });
}
