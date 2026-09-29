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

  // Los comentarios pueden hablar de git y de procesos: solo cuenta el código.
  const sinComentarios = (texto: string): string => texto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  test('solo git.ts lanza procesos', async () => {
    for (const archivo of await archivosTs(SRC)) {
      if (path.basename(archivo) === 'git.ts') continue;
      assert.doesNotMatch(sinComentarios(await readFile(archivo, 'utf8')), /child_process|\brequire\(|\bimport\(/, archivo);
    }
  });

  // git es un puerto, ConsultasGit: nadie fuera de git.ts arma un comando de git. Lo que git.ts ofrece hacia
  // afuera es una lista cerrada: un ejecutor de comandos exportado, con el nombre que sea, la rompe. La prueba vigila
  // las formas habituales; no puede demostrar que nadie interprete la salida de git por otro camino.
  test('nadie fuera de git.ts arma comandos de git y git.ts no exporta su ejecutor', async () => {
    const comandos = /--end-of-options|--porcelain|\bexecFile\b|salidasValidas|\[\s*'(?:rev-parse|log|grep|tag|diff|ls-files)'/;
    for (const archivo of await archivosTs(SRC)) {
      if (path.basename(archivo) === 'git.ts') continue;
      assert.doesNotMatch(sinComentarios(await readFile(archivo, 'utf8')), comandos, archivo);
    }
    const exportado = sinComentarios(await readFile(path.join(SRC, 'git.ts'), 'utf8'));
    assert.doesNotMatch(exportado, /^export \{/m, 'git.ts exporta por nombre');
    const nombres = [...exportado.matchAll(/^export (?:async )?(?:function|const|type|interface|class) (\w+)/gm)].map((m) => m[1]).sort();
    assert.deepEqual(nombres, ['Commit', 'ConsultasGit', 'OpcionesGit', 'PATRON_REF', 'crearConsultasGit', 'salidaAceptada', 'validarRef']);
  });
  // Qué es una referencia de git (una rama, un tag, un SHA) lo dice git.ts, que las valida antes de lanzar nada: la
  // configuración de las ramas usa su patrón en vez de escribir otro. Vigila la forma habitual de repetirlo.
  test('solo git.ts define qué es una referencia de git', async () => {
    const patron = /\(\?!\.\*\\\.\\\.\)/; // el «sin ..» del patrón
    for (const archivo of await archivosTs(SRC)) {
      if (path.basename(archivo) === 'git.ts') continue;
      assert.doesNotMatch(sinComentarios(await readFile(archivo, 'utf8')), patron, archivo);
    }
  });

  // Solo aplicar.ts (por el escritor de la sesión), sesion.ts (que lo trae) e iniciar.ts (que crea las notas del
  // sistema al preparar el proyecto, fuera de los cambios preparados) importan escritura.ts.
  test('solo aplicar.ts, sesion.ts e iniciar.ts importan escritura.ts', async () => {
    const permitidos = ['aplicar.ts', 'escritura.ts', 'iniciar.ts', 'sesion.ts'];
    for (const archivo of await archivosTs(SRC)) {
      const nombre = path.relative(SRC, archivo);
      if (permitidos.includes(nombre)) continue;
      assert.doesNotMatch(sinComentarios(await readFile(archivo, 'utf8')), /from '(?:\.\.?\/)+escritura\.ts'/, `${nombre} importa escritura.ts`);
    }
    for (const nombre of ['aplicar.ts', 'sesion.ts', 'iniciar.ts']) {
      assert.match(await readFile(path.join(SRC, nombre), 'utf8'), /from '\.\/escritura\.ts'/, `${nombre} debería importar escritura.ts`);
    }
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

  // La sesión es lo que reciben los preparadores, aplicar y las herramientas: el guardia lo construye solo el arranque,
  // y el almacén de códigos y el tope de escrituras, solo la sesión. Así una prueba puede crear la suya con reloj de
  // mentira, y nadie tiene un segundo almacén con otros códigos. La prueba vigila las formas habituales.
  test('solo arranque.ts construye el guardia y solo sesion.ts el almacén y el tope', async () => {
    const reglas: { patron: RegExp; permitidos: string[] }[] = [
      { patron: /\bcrearGuardia\(/, permitidos: ['arranque.ts', 'guardia.ts'] },
      { patron: /\b(?:crearAlmacen|crearTope)\(/, permitidos: ['sesion.ts', 'almacen.ts'] },
    ];
    for (const archivo of await archivosTs(SRC)) {
      const texto = sinComentarios(await readFile(archivo, 'utf8'));
      for (const { patron, permitidos } of reglas) {
        if (permitidos.includes(path.relative(SRC, archivo))) continue;
        assert.doesNotMatch(texto, patron, archivo);
      }
    }
  });

  // El escritor de escritura.ts solo se llama por el de la sesión, y el de verdad solo lo pone la sesión: así una
  // prueba puede poner uno de mentira. La excepción es iniciar.ts, que crea las notas del sistema al preparar el
  // proyecto, sin sesión, con crearExclusivo. Vigila las formas habituales.
  test('nadie llama al escritor de escritura.ts sin pasar por la sesión, salvo iniciar, y aplicar lo usa', async () => {
    for (const archivo of await archivosTs(SRC)) {
      const nombre = path.relative(SRC, archivo);
      const texto = sinComentarios(await readFile(archivo, 'utf8'));
      if (nombre !== 'escritura.ts' && nombre !== 'iniciar.ts') assert.doesNotMatch(texto, /(?<!escritor\.)\b(?:crearExclusivo|reemplazarAtomico)\(/, `${nombre} llama al escritor sin pasar por la sesión`);
      if (nombre !== 'escritura.ts' && nombre !== 'sesion.ts') assert.doesNotMatch(texto, /\bescritorReal\b/, `${nombre} usa el escritor de verdad`);
    }
    const aplicarTs = sinComentarios(await readFile(path.join(SRC, 'aplicar.ts'), 'utf8'));
    assert.match(aplicarTs, /sesion\.escritor\.crearExclusivo\(/);
    assert.match(aplicarTs, /sesion\.escritor\.reemplazarAtomico\(/);
    assert.match(sinComentarios(await readFile(path.join(SRC, 'iniciar.ts'), 'utf8')), /\bcrearExclusivo\(/, 'iniciar crea las notas del sistema con crearExclusivo');
  });

  // Una fuente con commit, «repo:<ruta>@<sha>», la escribe y la lee fuentes.ts, y el patrón del SHA es suyo. La prueba
  // vigila las formas habituales de escribirla, de leerla o de validar su SHA a mano en otro archivo, con plantillas,
  // con concatenación o con startsWith; no puede demostrar que nadie interprete una fuente por otro camino. Un texto
  // de documentación, como «repo:<ruta>@<sha>» en la descripción de una herramienta, no cuenta.
  test('solo fuentes.ts escribe y lee las fuentes con commit', async () => {
    const fuente = /(?:repo|doc):\$\{|\$\{[^}]*\}:\$\{[^}]*\}@|['"`](?:repo|doc):['"`]\s*\+|startsWith\(['"`](?:repo|doc):|\(\?:repo\|doc\)|\(repo\|doc\)|\[0-9a-f\]\{7,40\}/;
    for (const archivo of await archivosTs(SRC)) {
      if (path.relative(SRC, archivo) === 'fuentes.ts') continue;
      assert.doesNotMatch(sinComentarios(await readFile(archivo, 'utf8')), fuente, archivo);
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
