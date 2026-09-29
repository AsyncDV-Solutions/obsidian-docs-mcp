import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import * as z from 'zod/v4';
import { ErrorMcp } from './errores.ts';
import { PATRON_PREFIJO } from './ids.ts';

// Prefijo de las variables de entorno: ASYNCDV_DOCS_<CLAVE EN MAYÚSCULAS> (p. ej. ASYNCDV_DOCS_VAULT_PATH).
export const PREFIJO_ENTORNO = 'ASYNCDV_DOCS_';
export const VARIABLE_CONFIG = `${PREFIJO_ENTORNO}CONFIG`;
const NOMBRE_CARPETA_ESTADO = 'asyncdv-docs-mcp';

// Ruta absoluta local del sistema en uso: en Windows, con letra de unidad (C:\…); en macOS y Linux, desde "/".
// Rechaza rutas relativas y de red (\\servidor o //servidor).
export function esRutaAbsolutaLocal(ruta: string): boolean {
  if (process.platform === 'win32') return /^[A-Za-z]:[\\/]/.test(ruta);
  return ruta.startsWith('/') && !ruta.startsWith('//');
}

const EJEMPLO_ABSOLUTA = process.platform === 'win32' ? 'C:\\…' : '/…';

const RutaAbsoluta = z
  .string()
  .refine(esRutaAbsolutaLocal, `debe ser una ruta absoluta local (${EJEMPLO_ABSOLUTA})`)
  .refine((ruta) => !/[\x00-\x1f]/.test(ruta), 'tiene caracteres de control');

// Un segmento de una ruta del vault: sin ".." ni carpetas ocultas, sin caracteres prohibidos en
// Windows y sin punto ni espacio al final (Windows los ignora: serían dos nombres para lo mismo).
// Se exige en todos los sistemas: un vault suele sincronizarse entre equipos distintos.
function segmentoValido(segmento: string): boolean {
  return (
    segmento.length > 0 &&
    !segmento.startsWith('.') &&
    !/[\\/:*?"<>|\x00-\x1f]/.test(segmento) &&
    !/[. ]$/.test(segmento)
  );
}

const RutaProyecto = z
  .string()
  .max(200)
  .refine(
    (ruta) => ruta.split('/').every(segmentoValido),
    'debe ser relativa al vault, separada con "/", sin "..", sin carpetas ocultas ni caracteres no válidos',
  );

// Ruta relativa a la raíz del repo, separada con "/". Admite carpetas ocultas (.github).
function rutaRepoValida(ruta: string): boolean {
  return ruta.split('/').every((s) => s !== '' && s !== '.' && s !== '..' && !/[\\:*?"<>|\x00-\x1f]/.test(s) && !/[. ]$/.test(s));
}

const RutaRepo = z.string().min(1).max(260).refine(rutaRepoValida, 'debe ser relativa a la raíz del repo, separada con "/", sin "." ni ".."');

// Prefijo de rutas del repo: como RutaRepo, pero puede terminar en "/" (api/ no calza con api-docs/).
const PrefijoRepo = z
  .string()
  .min(1)
  .max(260)
  .refine((prefijo) => rutaRepoValida(prefijo.replace(/\/$/, '')), 'debe ser relativo a la raíz del repo, p. ej. "api/" o "package.json"');

// Patrón de exclusión: ** (cualquier profundidad), * (dentro de un segmento) y ? (un carácter).
const Patron = z
  .string()
  .min(1)
  .max(200)
  .refine((p) => !/[\\\x00-\x1f]/.test(p) && !p.startsWith('/'), 'debe ser relativo a la raíz del repo, separado con "/"');

const Ref = z.string().regex(/^(?!-)(?!.*\.\.)[A-Za-z0-9._/-]{1,100}$/, 'no es un nombre de rama válido');
const Lista = z.array(z.string().min(1).max(40).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'solo minúsculas, dígitos y guiones'));

function zonaValida(zona: string): boolean {
  try {
    new Intl.DateTimeFormat('es', { timeZone: zona });
    return true;
  } catch {
    return false;
  }
}

function sinRepetidos(valores: string[]): boolean {
  return new Set(valores).size === valores.length;
}

// Límites de seguridad. Todos tienen un valor por defecto: config.json no necesita nombrarlos.
const Limites = z.strictObject({
  nota_max_kb: z.number().int().positive().max(1024).default(256),
  yaml_max_kb: z.number().int().positive().max(64).default(16),
  campo_max_kb: z.number().int().positive().max(256).default(64),
  repo_archivo_max_kb: z.number().int().positive().max(1024).default(64),
  resultados_max: z.number().int().positive().max(200).default(50),
  notas_max: z.number().int().positive().max(20000).default(5000),
  escrituras_por_minuto: z.number().int().positive().max(60).default(10),
  confirmacion_minutos: z.number().int().positive().max(30).default(5),
  git_timeout_ms: z.number().int().positive().max(30000).default(5000),
});

// Carpetas de cada tipo de nota, relativas a la carpeta del proyecto. Deben existir (pnpm run iniciar las crea).
const Carpetas = z.strictObject({
  tareas: RutaProyecto.default('Tareas'),
  funcionalidades: RutaProyecto.default('Funcionalidades'),
  decisiones: RutaProyecto.default('Decisiones'),
  incidencias: RutaProyecto.default('Incidencias'),
  releases: RutaProyecto.default('Releases'),
  guias: RutaProyecto.default('Guias'),
});

// Una categoría de la lista de permitidos del repo: el MCP solo ve lo que calza con alguna.
const Categoria = z
  .strictObject({
    clave: z.string().regex(/^[a-z][a-z0-9_]{0,30}$/, 'minúsculas, dígitos y "_"'),
    descripcion: z.string().min(1).max(80),
    carpetas: z.array(RutaRepo).max(20).default([]), // se listan sus archivos con esas extensiones
    archivos: z.array(RutaRepo).max(50).default([]), // archivos sueltos: siempre se pueden leer
    extensiones: z.array(z.string().regex(/^\.[a-z0-9]{1,10}$/, 'como ".ts", en minúsculas')).max(30).default([]),
    leer_carpetas: z.boolean().default(true), // false: de las carpetas solo se ven los nombres
  })
  .refine((c) => c.carpetas.length === 0 || c.extensiones.length > 0, 'una categoría con carpetas necesita extensiones')
  .refine((c) => c.carpetas.length > 0 || c.archivos.length > 0, 'una categoría necesita carpetas o archivos');

export type Categoria = z.infer<typeof Categoria>;

// Lista de permitidos por defecto: pensada para un repo de código cualquiera. Ajústala en config.json.
export const CATEGORIAS_POR_DEFECTO: Categoria[] = [
  {
    clave: 'docs',
    descripcion: 'Documentación',
    carpetas: ['docs'],
    archivos: ['README.md', 'CONTRIBUTING.md', 'CHANGELOG.md', 'CLAUDE.md', 'AGENTS.md'],
    extensiones: ['.md', '.mdx'],
    leer_carpetas: true,
  },
  {
    clave: 'manifiesto',
    descripcion: 'Manifiestos y dependencias',
    carpetas: [],
    archivos: ['package.json', 'pyproject.toml', 'requirements.txt', 'go.mod', 'Cargo.toml', 'composer.json', 'Gemfile', 'pom.xml', 'build.gradle', 'build.gradle.kts'],
    extensiones: [],
    leer_carpetas: false,
  },
  {
    clave: 'codigo',
    descripcion: 'Código fuente',
    carpetas: ['src', 'app', 'lib', 'packages'],
    archivos: [],
    extensiones: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte', '.astro', '.py', '.go', '.rs', '.java', '.kt', '.rb', '.php', '.cs', '.swift', '.dart', '.sql'],
    leer_carpetas: true,
  },
  {
    clave: 'pruebas',
    descripcion: 'Pruebas',
    carpetas: ['test', 'tests', '__tests__', 'spec'],
    archivos: [],
    extensiones: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.py', '.go', '.rs', '.java', '.kt', '.rb', '.php', '.cs', '.sql'],
    leer_carpetas: true,
  },
  {
    clave: 'bd',
    descripcion: 'Base de datos y migraciones',
    carpetas: ['migrations', 'db', 'database', 'prisma', 'supabase'],
    archivos: [],
    extensiones: ['.sql', '.prisma'],
    leer_carpetas: true,
  },
  { clave: 'workflows', descripcion: 'Workflows de CI', carpetas: ['.github/workflows'], archivos: [], extensiones: ['.yml', '.yaml'], leer_carpetas: true },
  { clave: 'prompts', descripcion: 'Prompts de agentes', carpetas: ['.github/prompts'], archivos: [], extensiones: ['.md'], leer_carpetas: true },
  {
    clave: 'scripts_ci',
    descripcion: 'Scripts de CI',
    carpetas: ['.github/scripts'],
    archivos: [],
    extensiones: ['.js', '.mjs', '.cjs', '.ts', '.sh', '.ps1', '.py'],
    leer_carpetas: true,
  },
];

export const AREAS_POR_DEFECTO = ['frontend', 'backend', 'bd', 'infra', 'ci-cd', 'seguridad', 'docs', 'ops'];
export const AMBIENTES_POR_DEFECTO = ['produccion', 'staging', 'local', 'repositorio'];

const Repo = z.strictObject({
  categorias: z
    .array(Categoria)
    .min(1)
    .max(30)
    .refine((cs) => sinRepetidos(cs.map((c) => c.clave)), 'las claves de las categorías no se pueden repetir')
    .default(CATEGORIAS_POR_DEFECTO),
  excluir: z.array(Patron).max(100).default([]), // se suman a las exclusiones fijas (.env, llaves, .git, node_modules…)
});

const Release = z.strictObject({
  rama_principal: Ref.default('main'),
  rama_desarrollo: Ref.optional(), // sin ella no se revisa la divergencia entre ramas
  lista_verificacion: z.array(z.string().min(1).max(300)).max(30).default([
    'El CI terminó en verde para {head}',
    'Lo que vas a publicar corresponde al mismo SHA ({head})',
    'Revisaste estas notas',
  ]),
  migraciones: z
    .strictObject({
      carpeta: RutaRepo,
      marcador_destructivo: z.string().min(3).max(100).regex(/^[^\r\n]*$/).optional(), // texto que marca una migración como incompatible
    })
    .optional(),
  senales: z.array(z.strictObject({ prefijo: PrefijoRepo, mensaje: z.string().min(1).max(300) })).max(50).default([]),
});

export const EsquemaConfig = z.strictObject({
  schema_version: z.literal(1),
  project_id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'solo minúsculas, dígitos y guiones'),
  // Nombre legible; por defecto, project_id. Va dentro del comando git tag que copias a tu terminal:
  // sin comillas, $, ` ni \, para que pegarlo nunca ejecute nada.
  project_name: z.string().min(1).max(80).regex(/^[^\r\n"`$\\]*$/, 'sin saltos de línea, comillas dobles, $, ` ni \\').optional(),
  id_prefix: z.string().regex(PATRON_PREFIJO, 'de 2 a 5 letras mayúsculas'),
  repo_path: RutaAbsoluta,
  vault_path: RutaAbsoluta,
  project_dir: RutaProyecto,
  zona_horaria: z.string().refine(zonaValida, 'zona horaria IANA desconocida (p. ej. America/Santiago, Europe/Madrid, UTC)'),
  git_path: RutaAbsoluta.optional(), // git con ruta absoluta (sin él, las herramientas del repo quedan bloqueadas)
  state_dir: RutaAbsoluta.optional(), // logs y bloqueo de escritura; por defecto, la carpeta de config.json
  plantillas_dir: RutaAbsoluta.optional(), // plantillas propias; las que falten se toman de plantillas/
  usuario: z.string().min(1).max(80).regex(/^[^\r\n]*$/).optional(), // pedido_por por defecto
  docs_historicos: z.array(z.string().min(1).max(260)).max(200).default([]), // rutas del repo; un "*" final marca un prefijo
  carpetas: Carpetas.prefault({}),
  areas: Lista.min(1).max(40).refine(sinRepetidos, 'hay áreas repetidas').default(AREAS_POR_DEFECTO),
  ambientes: Lista.min(1).max(20).refine(sinRepetidos, 'hay ambientes repetidos').default(AMBIENTES_POR_DEFECTO),
  repo: Repo.prefault({}),
  release: Release.prefault({}),
  limites: Limites.prefault({}),
});

export type Config = z.infer<typeof EsquemaConfig>;
export type LimitesConfig = Config['limites'];

// Claves simples que también se pueden dar como variables de entorno. Las listas y los objetos
// (categorías, release, límites…) solo van en config.json.
const CLAVES_ENTORNO = [
  'project_id',
  'project_name',
  'id_prefix',
  'repo_path',
  'vault_path',
  'project_dir',
  'zona_horaria',
  'git_path',
  'state_dir',
  'plantillas_dir',
  'usuario',
] as const;

export function variableDe(clave: string): string {
  return `${PREFIJO_ENTORNO}${clave.toUpperCase()}`;
}

export function nombreProyecto(config: Config): string {
  return config.project_name ?? config.project_id;
}

// De dónde sale la configuración: --config <ruta>, o ASYNCDV_DOCS_CONFIG. Sin ninguno, solo del entorno.
// Cualquier otro argumento es un error: el servidor no acepta nada más.
export function leerRutaConfig(args: string[], entorno: NodeJS.ProcessEnv): string | null {
  let valor: string | undefined;
  try {
    ({ config: valor } = parseArgs({ args, options: { config: { type: 'string' } }, strict: true, allowPositionals: false }).values);
  } catch {
    throw new ErrorMcp('ARGS', 'Argumentos no válidos: el servidor solo acepta --config <ruta absoluta>.');
  }
  const ruta = valor ?? (entorno[VARIABLE_CONFIG] || undefined);
  if (ruta === undefined) return null;
  // En Windows, pnpm run duplica las "\" de los argumentos (C:\\Users\\…): normalize las junta de nuevo.
  return esRutaAbsolutaLocal(ruta) ? path.normalize(ruta) : ruta;
}

export type ConfigCargada = { config: Config; rutaConfig: string | null };

// Carga config.json (si hay) y le aplica encima las variables ASYNCDV_DOCS_*. Después valida todo junto.
export async function cargarConfig(rutaConfig: string | null, entorno: NodeJS.ProcessEnv): Promise<ConfigCargada> {
  let crudo: Record<string, unknown> = {};
  if (rutaConfig !== null) {
    if (!esRutaAbsolutaLocal(rutaConfig)) {
      throw new ErrorMcp('CONFIG_RUTA', `La ruta de la configuración debe ser absoluta (${EJEMPLO_ABSOLUTA}).`);
    }
    let texto: string;
    try {
      texto = await readFile(rutaConfig, 'utf8');
    } catch {
      throw new ErrorMcp('CONFIG_NO_EXISTE', 'No pude leer el archivo de configuración indicado. ¿Existe?');
    }
    if (texto.startsWith('\uFEFF')) texto = texto.slice(1); // PowerShell 5.1 y otros editores agregan BOM
    let json: unknown;
    try {
      json = JSON.parse(texto);
    } catch {
      throw new ErrorMcp('CONFIG_JSON', 'config.json no es JSON válido.');
    }
    if (typeof json !== 'object' || json === null || Array.isArray(json)) {
      throw new ErrorMcp('CONFIG_JSON', 'config.json debe ser un objeto JSON.');
    }
    crudo = json as Record<string, unknown>;
  }

  // Las variables vacías cuentan como no definidas: algunos clientes MCP las mandan así.
  const delEntorno: Record<string, string> = {};
  for (const clave of CLAVES_ENTORNO) {
    const valor = entorno[variableDe(clave)];
    if (valor !== undefined && valor !== '') delEntorno[clave] = valor;
  }
  if (rutaConfig === null && Object.keys(delEntorno).length === 0) {
    throw new ErrorMcp(
      'CONFIG_FALTA',
      `No hay configuración: usa --config <ruta>, la variable ${VARIABLE_CONFIG} o las variables ${PREFIJO_ENTORNO}* (ver README).`,
    );
  }

  const resultado = EsquemaConfig.safeParse({ schema_version: 1, ...crudo, ...delEntorno });
  if (!resultado.success) {
    throw new ErrorMcp('CONFIG_ESQUEMA', `La configuración no cumple el esquema:\n${z.prettifyError(resultado.error)}`);
  }
  return { config: resultado.data, rutaConfig };
}

// Carpeta de estado (logs y bloqueo de escritura): state_dir, o la carpeta de config.json,
// o la carpeta de datos de la aplicación según el sistema.
export function carpetaEstado(cargada: ConfigCargada, entorno: NodeJS.ProcessEnv): string {
  if (cargada.config.state_dir !== undefined) return cargada.config.state_dir;
  if (cargada.rutaConfig !== null) return path.dirname(cargada.rutaConfig);
  const casa = os.homedir();
  if (process.platform === 'win32') return path.join(entorno.APPDATA || path.join(casa, 'AppData', 'Roaming'), NOMBRE_CARPETA_ESTADO);
  if (process.platform === 'darwin') return path.join(casa, 'Library', 'Application Support', NOMBRE_CARPETA_ESTADO);
  return path.join(entorno.XDG_STATE_HOME || path.join(casa, '.local', 'state'), NOMBRE_CARPETA_ESTADO);
}
