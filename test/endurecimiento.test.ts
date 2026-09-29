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

  test('solo git.ts lanza procesos', async () => {
    for (const archivo of await archivosTs(SRC)) {
      if (path.basename(archivo) === 'git.ts') continue;
      assert.doesNotMatch(await readFile(archivo, 'utf8'), /node:child_process/, archivo);
    }
  });

  // git es un puerto, ConsultasGit: nadie fuera de git.ts sabe armar un comando ni interpretar su salida, y el
  // ejecutor de comandos no se exporta. Así «solo lectura» lo garantiza la interfaz y no la disciplina de cada llamador.
  test('nadie fuera de git.ts arma comandos de git', async () => {
    const comandos = /--end-of-options|rev-parse|--porcelain|\bexecFile\b|salidasValidas/;
    for (const archivo of await archivosTs(SRC)) {
      if (path.basename(archivo) === 'git.ts') continue;
      assert.doesNotMatch(await readFile(archivo, 'utf8'), comandos, archivo);
    }
    assert.doesNotMatch(await readFile(path.join(SRC, 'git.ts'), 'utf8'), /export (?:async )?function git\(/, 'git.ts no debe exportar el ejecutor de comandos');
  });

  // Los preparadores reciben el texto libre del modelo y cada uno lo limpia antes de usarlo. Sin esto,
  // un preparador nuevo podría olvidarlo sin que ninguna prueba lo note. prepararTablero no recibe texto.
  test('cada preparador de tareas, documentos y release limpia el texto libre antes de usarlo', async () => {
    for (const archivo of ['tareas.ts', 'documentos.ts', 'release.ts']) {
      const partes = (await readFile(path.join(SRC, archivo), 'utf8')).split(/^export (?:async )?function /m).slice(1); // una por función exportada
      const preparadores = partes.filter((p) => p.startsWith('preparar'));
      assert.ok(preparadores.length > 0, `${archivo} debería exportar preparadores`);
      for (const parte of preparadores) {
        const llamada = parte.indexOf('limpiarTextoLibre(');
        const retorno = parte.search(/\breturn\b/);
        assert.ok(llamada >= 0 && (retorno < 0 || llamada < retorno), `${archivo}: ${parte.slice(0, parte.indexOf('('))} debe llamar a limpiarTextoLibre antes de su primer return`);
      }
    }
  });

  // El formato de un id lo define ids.ts: el índice, el tablero, iniciar, la configuración y los esquemas de
  // las herramientas lo derivan de ahí. Un patrón escrito a mano en otro archivo se desincroniza al agregar un tipo.
  // La prueba vigila las formas habituales de reescribirlo; no puede demostrar que nadie lo haga de otra manera.
  test('solo ids.ts define el formato de los ids', async () => {
    const formato = /\\d\{4,\}|\(T\|F\|I\|ADR\|G\)|R-v\\+d|R-v\$\{|\[A-Z\]\{2,5\}|padStart\(4|ultimo_|\$\{[^}]*\}-(?:T|F|I|G|ADR|R)-|\[\[\$\{/;
    for (const archivo of await archivosTs(SRC)) {
      if (path.basename(archivo) === 'ids.ts') continue;
      assert.doesNotMatch(await readFile(archivo, 'utf8'), formato, archivo);
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
