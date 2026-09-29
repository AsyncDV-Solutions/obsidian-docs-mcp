import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export function marcador(projectId = 'demo', prefijo = 'DEM'): string {
  return ['---', `project_id: ${projectId}`, 'type: proyecto', `id_prefix: ${prefijo}`, 'schema: 1', 'title: Demo', '---', 'Marcador de prueba.', ''].join('\n');
}

export type Escenario = {
  base: string;
  repo: string;
  vault: string;
  proyecto: string;
  dirConfig: string;
  rutaConfig: string;
  escribirConfig: (cambios?: Record<string, unknown>) => Promise<void>;
  limpiar: () => Promise<void>;
};

// Crea en una carpeta temporal un repo, un vault con su proyecto y una configuración válida.
export async function crearEscenario(): Promise<Escenario> {
  // realpath: la carpeta temporal podría tener nombres cortos (8.3); así todo parte de la ruta real.
  const base = await realpath(await mkdtemp(path.join(tmpdir(), 'asyncdv-mcp-')));
  const repo = path.join(base, 'repo');
  const vault = path.join(base, 'vault');
  const proyecto = path.join(vault, 'Proyectos', 'demo');
  const dirConfig = path.join(base, 'config');
  await mkdir(path.join(repo, '.git'), { recursive: true });
  await mkdir(proyecto, { recursive: true });
  await mkdir(dirConfig, { recursive: true });
  await writeFile(path.join(proyecto, '_proyecto.md'), marcador(), 'utf8');

  const rutaConfig = path.join(dirConfig, 'config.json');
  const config = {
    schema_version: 1,
    project_id: 'demo',
    id_prefix: 'DEM',
    repo_path: repo,
    vault_path: vault,
    project_dir: 'Proyectos/demo',
    zona_horaria: 'America/Santiago',
  };
  const escribirConfig = async (cambios: Record<string, unknown> = {}): Promise<void> => {
    await writeFile(rutaConfig, JSON.stringify({ ...config, ...cambios }, null, 2), 'utf8');
  };
  await escribirConfig();

  return {
    base,
    repo,
    vault,
    proyecto,
    dirConfig,
    rutaConfig,
    escribirConfig,
    limpiar: () => rm(base, { recursive: true, force: true }),
  };
}

export async function escribirNota(carpeta: string, relativa: string, texto: string): Promise<void> {
  const ruta = path.join(carpeta, ...relativa.split('/'));
  await mkdir(path.dirname(ruta), { recursive: true });
  await writeFile(ruta, texto, 'utf8');
}

export function notaTarea(o: {
  id: string;
  titulo: string;
  estado?: string;
  prioridad?: string;
  projectId?: string;
  extra?: string[];
  cuerpo?: string;
}): string {
  return [
    '---',
    `id: ${o.id}`,
    `project_id: ${o.projectId ?? 'demo'}`,
    'type: tarea',
    'schema: 1',
    `title: ${o.titulo}`,
    `status: ${o.estado ?? 'Por hacer'}`,
    `priority: ${o.prioridad ?? 'P2'}`,
    ...(o.extra ?? []),
    '---',
    o.cuerpo ?? '## Descripción\nTexto de prueba.\n',
  ].join('\n');
}

export function notaContadores(valores: Record<string, number> = {}): string {
  const todos = { ultimo_T: 0, ultimo_F: 0, ultimo_I: 0, ultimo_ADR: 0, ...valores };
  return [
    '---',
    'project_id: demo',
    'type: contadores',
    'schema: 1',
    'title: Contadores',
    ...Object.entries(todos).map(([clave, n]) => `${clave}: ${n}`),
    '---',
    'Contadores de prueba.',
    '',
  ].join('\n');
}

// git de esta máquina (el primero del PATH), con ruta absoluta. Solo lo usan las pruebas.
let gitCache: string | undefined;
export function rutaGit(): string {
  const [comando, args] = process.platform === 'win32' ? ['where.exe', ['git']] : ['which', ['git']];
  gitCache ??= execFileSync(comando, args, { encoding: 'utf8' }).split(/\r?\n/)[0]?.trim() || 'git';
  return gitCache;
}

export function gitDirecto(cwd: string, ...args: string[]): string {
  return execFileSync(rutaGit(), args, { cwd, encoding: 'utf8', stdio: 'pipe' });
}

// Reemplaza el .git falso del escenario por un repo git real, con identidad local.
export async function convertirEnRepoGit(repo: string): Promise<void> {
  await rm(path.join(repo, '.git'), { recursive: true, force: true });
  gitDirecto(repo, 'init', '-b', 'main');
  gitDirecto(repo, 'config', 'user.name', 'Prueba');
  gitDirecto(repo, 'config', 'user.email', 'prueba@example.com');
}

// Commit sin firmas ni ganchos: tu configuración global de git no debe interferir.
export function commitear(repo: string, mensaje: string): void {
  gitDirecto(repo, 'add', '-A');
  gitDirecto(repo, '-c', 'commit.gpgsign=false', 'commit', '--no-verify', '-m', mensaje);
}
