// git visto por consultas con intención: es el único módulo que lanza procesos, y ninguna otra parte
// del código sabe cómo se arma un comando de git. Cada consulta valida sus referencias, toma las rutas de forma
// literal, fija sus protecciones y parsea su salida; quien pregunta recibe datos. Todas son de solo lectura.
//
// ConsultasGit es el puerto: crearConsultasGit es el adaptador de producción (execFile) y las pruebas ponen
// otro que responde lo que la prueba declara, para ejercitar decisiones y fallos sin lanzar procesos.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ErrorMcp } from './errores.ts';

const ejecutarArchivo = promisify(execFile);

export type Commit = { sha: string; asunto: string; cuerpo: string };

// Toda consulta que falla termina en ErrorMcp GIT; sin git_path, en GIT_NO_CONFIGURADO. Las referencias
// que no tienen la forma de una referencia se rechazan con REF_INVALIDA antes de lanzar nada.
export type ConsultasGit = {
  // El commit completo al que apunta una referencia (una rama, un tag, HEAD, un SHA).
  resolver(ref: string): Promise<string>;
  cabezaCorta(): Promise<string>;
  ramaActual(): Promise<string>;
  // Los tags de versión, los que empiezan con «v».
  tagsDeVersion(): Promise<string[]>;
  existeTag(nombre: string): Promise<boolean>;
  // Los commits que están en head y no en base, del más nuevo al más viejo.
  commitsEntre(base: string, head: string): Promise<Commit[]>;
  // Las últimas líneas «sha fecha asunto», del más nuevo al más viejo.
  commitsRecientes(max: number): Promise<string[]>;
  // Cuántos commits hay en hasta que no están en desde.
  contarCommitsEntre(desde: string, hasta: string): Promise<number>;
  archivosCambiados(base: string, head: string): Promise<string[]>;
  // Los archivos de una carpeta que contienen el marcador, tal como están en ref. Sin coincidencias no es un fallo.
  archivosConMarcador(ref: string, marcador: string, carpeta: string): Promise<string[]>;
  // El último commit que tocó la ruta después del SHA, como «sha fecha asunto», o '' si no hubo ninguno.
  ultimoCambioDesde(sha: string, ruta: string): Promise<string>;
  // Cuántos archivos tienen cambios sin commitear.
  cambiosSinCommit(): Promise<number>;
  archivoConCambios(ruta: string): Promise<boolean>;
};

export type OpcionesGit = {
  git: string | null; // el archivo real de git, resuelto al arrancar
  repo: string; // la raíz real del repo
  timeoutMs: number;
};

// Referencias git aceptadas: letras, dígitos y . _ / -, sin ".." y sin empezar con "-".
const REF = /^(?!-)(?!.*\.\.)[A-Za-z0-9._/-]{1,100}$/;

export function validarRef(ref: string): string {
  if (!REF.test(ref)) throw new ErrorMcp('REF_INVALIDA', `Referencia git no válida: «${ref}».`);
  return ref;
}

// Entorno mínimo para git (Windows, macOS y Linux). No se heredan variables GIT_* que cambien su comportamiento.
function entornoGit(): Record<string, string> {
  const entorno: Record<string, string> = { GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' };
  for (const clave of ['SYSTEMROOT', 'USERPROFILE', 'HOME', 'HOMEDRIVE', 'HOMEPATH', 'PATH', 'TMPDIR']) {
    const valor = process.env[clave];
    if (valor !== undefined) entorno[clave] = valor;
  }
  return entorno;
}

// Si el error de execFile es una salida que el llamador declaró válida, devuelve su stdout; si no, null.
// Solo cuenta una salida declarada de un proceso que terminó solo y sin nada en stderr: git grep también
// termina con 1 cuando no pudo leer un objeto, y eso no es «sin coincidencias». Un proceso matado por el
// plazo o por una señal nunca cuenta, sea cual sea el código con el que termine.
export function salidaAceptada(error: unknown, salidasValidas: number[] = []): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const { code, signal, killed, stdout, stderr } = error as { code?: unknown; signal?: unknown; killed?: unknown; stdout?: unknown; stderr?: unknown };
  const terminoSolo = killed !== true && (signal === null || signal === undefined);
  const sinErrores = typeof stderr === 'string' ? stderr.trim() === '' : stderr === undefined || stderr === null;
  if (!terminoSolo || !sinErrores || typeof code !== 'number' || !salidasValidas.includes(code)) return null;
  return typeof stdout === 'string' ? stdout : '';
}

// git grep termina con 1 cuando no encuentra nada: no es un fallo.
const GREP_SIN_COINCIDENCIAS = 1;

const lineas = (salida: string): string[] => salida.split('\n').filter((l) => l !== '');

export function crearConsultasGit(opciones: OpcionesGit): ConsultasGit {
  // git SIN shell, con protecciones fijas. Solo se llama con subcomandos de lectura.
  // salidasValidas: códigos de salida que no son un fallo para ese subcomando (ver salidaAceptada).
  async function git(args: string[], salidasValidas?: number[]): Promise<string> {
    if (opciones.git === null) throw new ErrorMcp('GIT_NO_CONFIGURADO', 'Falta git_path (o ASYNCDV_DOCS_GIT_PATH): la ruta absoluta de git.');
    const protecciones = ['-C', opciones.repo, '--no-pager', '--no-optional-locks', '--literal-pathspecs', '-c', 'core.fsmonitor=false', '-c', 'log.showSignature=false'];
    try {
      const { stdout } = await ejecutarArchivo(opciones.git, [...protecciones, ...args], {
        encoding: 'utf8',
        timeout: opciones.timeoutMs,
        maxBuffer: 2 * 1024 * 1024,
        windowsHide: true,
        shell: false,
        env: entornoGit(),
      });
      return stdout;
    } catch (error) {
      const salida = salidaAceptada(error, salidasValidas);
      if (salida !== null) return salida;
      throw new ErrorMcp('GIT', `git ${args[0] ?? ''} falló o tardó demasiado.`);
    }
  }

  return {
    async resolver(ref) {
      return (await git(['rev-parse', '--verify', '--end-of-options', `${validarRef(ref)}^{commit}`])).trim();
    },

    async cabezaCorta() {
      return (await git(['rev-parse', '--short', 'HEAD'])).trim();
    },

    async ramaActual() {
      return (await git(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
    },

    async tagsDeVersion() {
      return lineas(await git(['tag', '--list', 'v*']));
    },

    async existeTag(nombre) {
      return lineas(await git(['tag', '--list', validarRef(nombre)])).length > 0;
    },

    async commitsEntre(base, head) {
      const registros = await git(['log', '--format=%H%x1f%s%x1f%b%x1e', '--end-of-options', `${validarRef(base)}..${validarRef(head)}`]);
      return registros
        .split('\x1e')
        .map((r) => r.trim())
        .filter((r) => r !== '')
        .map((r) => {
          const [sha = '', asunto = '', cuerpo = ''] = r.split('\x1f');
          return { sha, asunto, cuerpo };
        });
    },

    async commitsRecientes(max) {
      if (!Number.isInteger(max) || max < 1) throw new ErrorMcp('ARGUMENTOS', 'commitsRecientes pide un número entero de commits, de 1 en adelante.');
      return lineas(await git(['log', '-n', String(max), '--format=%h %ad %s', '--date=short', '--end-of-options', 'HEAD']));
    },

    async contarCommitsEntre(desde, hasta) {
      return lineas(await git(['log', '--format=%H', '--end-of-options', `${validarRef(desde)}..${validarRef(hasta)}`])).length;
    },

    async archivosCambiados(base, head) {
      return lineas(await git(['diff', '--name-only', '--no-renames', '--no-ext-diff', '--no-textconv', '--end-of-options', validarRef(base), validarRef(head)]));
    },

    async archivosConMarcador(ref, marcador, carpeta) {
      const salida = await git(['grep', '-l', '--fixed-strings', '-e', marcador, validarRef(ref), '--', carpeta], [GREP_SIN_COINCIDENCIAS]);
      return lineas(salida).map((l) => l.slice(l.indexOf(':') + 1)); // «<ref>:ruta» → «ruta»
    },

    async ultimoCambioDesde(sha, ruta) {
      return (await git(['log', '-n', '1', '--format=%h %ad %s', '--date=short', '--end-of-options', `${validarRef(sha)}..HEAD`, '--', ruta])).trim();
    },

    async cambiosSinCommit() {
      return lineas(await git(['status', '--porcelain=v1'])).length;
    },

    async archivoConCambios(ruta) {
      return lineas(await git(['status', '--porcelain=v1', '--', ruta])).length > 0;
    },
  };
}
