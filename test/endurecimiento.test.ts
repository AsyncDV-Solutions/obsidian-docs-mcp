import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

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
});
