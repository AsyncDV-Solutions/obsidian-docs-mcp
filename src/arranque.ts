import { mkdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import * as z from 'zod/v4';
import { carpetaEstado, cargarConfig, esRutaAbsolutaLocal, leerRutaConfig } from './config.ts';
import type { Config } from './config.ts';
import { ErrorMcp } from './errores.ts';
import { separarNota } from './frontmatter.ts';
import { contiene, mismaRuta, rutaCanonica } from './rutas.ts';
import { crearGuardia } from './guardia.ts';
import { cargarPlantilla, PLANTILLAS } from './plantillas.ts';
import type { TipoPlantilla } from './plantillas.ts';

export type Contexto = {
  config: Config;
  dirEstado: string; // carpeta real de logs y del bloqueo de escritura, fuera del vault y del repo
  repo: string; // raíz real del repo documentado
  proyecto: string; // carpeta real del proyecto dentro del vault
  plantillas: string | null; // carpeta real de plantillas_dir, si se configuró
  git: string | null; // archivo real de git_path (un enlace se resuelve al arrancar), si se configuró
};

export type Problema = { codigo: string; mensaje: string };

export type EstadoArranque = { ok: true; ctx: Contexto } | { ok: false; problemas: Problema[] };

export const NODE_MINIMO = 24; // type stripping estable y modelo de permisos (--permission)

const Marcador = z.object({
  project_id: z.string(),
  type: z.literal('proyecto'),
  id_prefix: z.string(),
  schema: z.literal(1),
});

// Ejecuta una comprobación. Si falla, anota el problema y devuelve undefined.
async function intentar<T>(problemas: Problema[], comprobar: () => Promise<T>): Promise<T | undefined> {
  try {
    return await comprobar();
  } catch (error) {
    problemas.push(
      error instanceof ErrorMcp
        ? { codigo: error.codigo, mensaje: error.message }
        : { codigo: 'INTERNO', mensaje: 'Error inesperado durante la validación.' },
    );
    return undefined;
  }
}

// La carpeta de estado se crea si falta: solo guarda logs y el bloqueo de escritura.
async function prepararCarpetaEstado(ruta: string): Promise<string> {
  if (!esRutaAbsolutaLocal(ruta)) throw new ErrorMcp('ESTADO_RUTA', 'La carpeta de estado (state_dir) debe ser una ruta absoluta local.');
  try {
    await mkdir(ruta, { recursive: true });
  } catch {
    throw new ErrorMcp('ESTADO_NO_CREADA', 'No pude crear la carpeta de estado (state_dir). ¿Tienes permisos de escritura?');
  }
  return rutaCanonica(ruta, 'La carpeta de estado (state_dir)');
}

// entorno: las variables del proceso. Las pruebas pasan {} para no depender de la máquina.
export async function validarArranque(args: string[], entorno: NodeJS.ProcessEnv = process.env): Promise<EstadoArranque> {
  const problemas: Problema[] = [];

  // 1. Node 24 o posterior.
  const mayor = Number(process.versions.node.split('.')[0]);
  if (mayor < NODE_MINIMO) {
    problemas.push({ codigo: 'NODE_VERSION', mensaje: `Se requiere Node ${NODE_MINIMO} o posterior y este proceso usa ${process.version}.` });
  }

  // 2. Configuración: argumento o variable, archivo, entorno y esquema. Sin ella no se puede seguir.
  const cargada = await intentar(problemas, async () => cargarConfig(leerRutaConfig(args, entorno), entorno));
  if (cargada === undefined) return { ok: false, problemas };
  const { config, rutaConfig } = cargada;

  // 3. Rutas reales: existen y no pasan por enlaces. La raíz del vault nunca se toca.
  const dirConfig = rutaConfig === null ? null : await intentar(problemas, () => rutaCanonica(path.dirname(rutaConfig), 'La carpeta de config.json'));
  const repo = await intentar(problemas, () => rutaCanonica(config.repo_path, 'repo_path'));
  const proyecto = await intentar(problemas, () =>
    rutaCanonica(path.join(config.vault_path, ...config.project_dir.split('/')), 'La carpeta del proyecto (vault_path + project_dir)'),
  );
  const plantillasDir = config.plantillas_dir;
  const plantillas = plantillasDir === undefined ? null : await intentar(problemas, () => rutaCanonica(plantillasDir, 'plantillas_dir'));
  if (dirConfig === undefined || repo === undefined || proyecto === undefined || plantillas === undefined) return { ok: false, problemas };

  // La carpeta de estado se comprueba ANTES de crearla: nunca se crea nada dentro del vault ni del repo.
  const vault = path.resolve(config.vault_path);
  const rutaEstado = carpetaEstado(cargada, entorno);
  const estadoDentro = (carpeta: string): boolean => contiene(vault, carpeta) || contiene(repo, carpeta);
  if (esRutaAbsolutaLocal(rutaEstado) && estadoDentro(path.resolve(rutaEstado))) {
    problemas.push({ codigo: 'CONFIG_DENTRO', mensaje: 'La carpeta de estado (state_dir) no puede estar dentro del vault ni del repo.' });
    return { ok: false, problemas };
  }
  const dirEstado = await intentar(problemas, () => prepararCarpetaEstado(rutaEstado));
  if (dirEstado === undefined) return { ok: false, problemas };

  // 4. Relaciones entre carpetas (comparación de rutas; no requiere leer el vault).
  if (mismaRuta(proyecto, vault) || !contiene(vault, proyecto)) {
    problemas.push({ codigo: 'PROYECTO_FUERA', mensaje: 'project_dir debe ser una subcarpeta del vault.' });
  }
  if (contiene(repo, vault) || contiene(vault, repo)) {
    problemas.push({ codigo: 'SOLAPAMIENTO', mensaje: 'El repo y el vault no pueden estar uno dentro del otro.' });
  }
  for (const [carpeta, nombre] of [[dirConfig, 'La carpeta de config.json'], [dirEstado, 'La carpeta de estado (state_dir)']] as const) {
    if (carpeta !== null && (contiene(vault, carpeta) || contiene(repo, carpeta))) {
      problemas.push({ codigo: 'CONFIG_DENTRO', mensaje: `${nombre} no puede estar dentro del vault ni del repo.` });
    }
  }
  if (plantillas !== null && contiene(vault, plantillas)) {
    problemas.push({ codigo: 'PLANTILLAS_DENTRO', mensaje: 'plantillas_dir no puede estar dentro del vault: las notas no deben poder cambiar las plantillas.' });
  }

  // 5. El repo tiene .git (carpeta o archivo).
  await intentar(problemas, async () => {
    try {
      await stat(path.join(repo, '.git'));
    } catch {
      throw new ErrorMcp('REPO_SIN_GIT', 'repo_path no tiene .git: no parece la raíz de un repositorio.');
    }
  });

  // 6. El marcador del proyecto.
  await intentar(problemas, () => validarMarcador(proyecto, config));

  // 7. Las plantillas existen y calzan con sus campos.
  for (const tipo of Object.keys(PLANTILLAS) as TipoPlantilla[]) await intentar(problemas, () => cargarPlantilla(tipo, plantillas));

  // 8. git: el archivo real (git_path puede ser un enlace, como el de Homebrew).
  const gitPath = config.git_path;
  const git = gitPath === undefined ? null : await intentar(problemas, () => resolverGit(gitPath));
  if (git === undefined) return { ok: false, problemas };

  return problemas.length === 0 ? { ok: true, ctx: { config, dirEstado, repo, proyecto, plantillas, git } } : { ok: false, problemas };
}

// A diferencia de las carpetas (rutaCanonica), git_path SÍ puede ser un enlace: Homebrew instala
// /opt/homebrew/bin/git → ../Cellar/git/<versión>/bin/git, y exigir la ruta de Cellar se rompería
// con cada actualización. Se resuelve UNA vez al arrancar y se ejecuta ese archivo: si el enlace
// cambia después, no cambia qué se ejecuta.
// Se lee solo la ruta dada (stat sigue el enlace): con los permisos de Node basta
// --allow-fs-read=<git_path>; leer la ruta real exigiría permitir también Cellar.
async function resolverGit(ruta: string): Promise<string> {
  const dada = path.resolve(ruta);
  let esArchivo: boolean;
  let real: string;
  try {
    esArchivo = (await stat(dada)).isFile();
    real = await realpath(dada);
  } catch {
    throw new ErrorMcp('RUTA_NO_EXISTE', 'git_path no existe o no se puede leer.');
  }
  if (!esArchivo) throw new ErrorMcp('GIT_NO_ARCHIVO', 'git_path debe ser el ejecutable de git, no una carpeta.');
  return real;
}

async function validarMarcador(proyecto: string, config: Config): Promise<void> {
  const guardia = crearGuardia(proyecto, config.limites);
  let texto: string;
  try {
    ({ texto } = await guardia.leer('_proyecto.md'));
  } catch (error) {
    if (error instanceof ErrorMcp && error.codigo === 'NOTA_NO_EXISTE') {
      throw new ErrorMcp('MARCADOR_FALTA', 'Falta _proyecto.md en la carpeta del proyecto: créalo con «pnpm run iniciar».');
    }
    throw error;
  }
  const { datos } = separarNota(texto, config.limites.yaml_max_kb * 1024);
  const marcador = Marcador.safeParse(datos);
  if (!marcador.success) {
    throw new ErrorMcp('MARCADOR_INVALIDO', '_proyecto.md debe tener project_id, type: proyecto, id_prefix y schema: 1.');
  }
  if (marcador.data.project_id !== config.project_id) {
    throw new ErrorMcp('MARCADOR_AJENO', 'El project_id de _proyecto.md no coincide con la configuración.');
  }
  if (marcador.data.id_prefix !== config.id_prefix) {
    throw new ErrorMcp('MARCADOR_PREFIJO', 'El id_prefix de _proyecto.md no coincide con la configuración.');
  }
}
