import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { crearEscenario, rutaGit } from './helpers.ts';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const RAIZ = fileURLToPath(new URL('../', import.meta.url));

async function archivosTs(carpeta: string): Promise<string[]> {
  const salida: string[] = [];
  for (const e of await readdir(carpeta, { withFileTypes: true })) {
    const ruta = path.join(carpeta, e.name);
    if (e.isDirectory()) salida.push(...(await archivosTs(ruta)));
    else if (e.name.endsWith('.ts')) salida.push(ruta);
  }
  return salida;
}

describe('endurecimiento', () => {
  test('el código no usa red', async () => {
    const prohibido = /from 'node:(http|https|http2|net|tls|dgram|dns)'|\bfetch\(|\bWebSocket\b/;
    for (const archivo of await archivosTs(SRC)) {
      assert.doesNotMatch(await readFile(archivo, 'utf8'), prohibido, archivo);
    }
  });

  test('solo repo.ts lanza procesos', async () => {
    for (const archivo of await archivosTs(SRC)) {
      if (path.basename(archivo) === 'repo.ts') continue;
      assert.doesNotMatch(await readFile(archivo, 'utf8'), /node:child_process/, archivo);
    }
  });

  // cambios.ts prepara todo lo que se escribe en el vault; iniciar.ts solo crea las notas del sistema.
  test('solo cambios.ts e iniciar.ts arman el contenido de una nota (frontmatter.ts la define)', async () => {
    for (const archivo of await archivosTs(SRC)) {
      if (['cambios.ts', 'iniciar.ts', 'frontmatter.ts'].includes(path.basename(archivo))) continue;
      assert.doesNotMatch(await readFile(archivo, 'utf8'), /\bunirNota\(/, archivo);
    }
  });

  test('con --permission, escribir fuera de lo permitido falla con ERR_ACCESS_DENIED', async () => {
    const base = await realpath(await mkdtemp(path.join(tmpdir(), 'asyncdv-permisos-')));
    try {
      const permitida = path.join(base, 'permitida');
      await mkdir(permitida);
      const script = path.join(base, 'intento.mjs');
      const fuera = JSON.stringify(path.join(base, 'fuera.txt'));
      await writeFile(
        script,
        `import { writeFileSync } from 'node:fs';\ntry { writeFileSync(${fuera}, 'x'); console.log('ESCRIBIO'); } catch (e) { console.log(e.code); }\n`,
        'utf8',
      );
      const r = spawnSync(process.execPath, ['--permission', `--allow-fs-read=${base}`, `--allow-fs-write=${permitida}`, script], { encoding: 'utf8' });
      assert.equal(r.stdout.trim(), 'ERR_ACCESS_DENIED');
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  // Homebrew: git_path es un enlace y su archivo real (Cellar) queda fuera de --allow-fs-read.
  test('con --permission, un git_path enlazado arranca permitiendo solo el enlace', async (t) => {
    const esc = await crearEscenario();
    try {
      const enlace = path.join(esc.base, 'bin', process.platform === 'win32' ? 'git.exe' : 'git');
      await mkdir(path.dirname(enlace));
      try {
        await symlink(rutaGit(), enlace, 'file');
      } catch {
        t.skip('No ejecutada: este sistema no permite crear symlinks sin privilegios');
        return;
      }
      await esc.escribirConfig({ git_path: enlace });
      const script = path.join(esc.base, 'arrancar.mjs');
      const arranque = JSON.stringify(pathToFileURL(path.join(SRC, 'arranque.ts')).href);
      const codigo = [
        `import { validarArranque } from ${arranque};`,
        `const e = await validarArranque(['--config', ${JSON.stringify(esc.rutaConfig)}], {});`,
        `console.log(e.ok ? 'OK' : e.problemas.map((p) => p.codigo).join(','));`,
      ];
      await writeFile(script, codigo.join('\n'), 'utf8');
      const permisos = ['--permission', `--allow-fs-read=${RAIZ}`, `--allow-fs-read=${esc.base}`, `--allow-fs-write=${esc.base}`];
      const r = spawnSync(process.execPath, [...permisos, script], { encoding: 'utf8' });
      assert.equal(r.stdout.trim(), 'OK', r.stderr);
    } finally {
      await esc.limpiar();
    }
  });
});
