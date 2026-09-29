import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, chmod, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { crearConsultasGit, salidaAceptada, validarRef } from '../src/git.ts';
import type { ConsultasGit } from '../src/git.ts';
import { codigoDe, commitear, convertirEnRepoGit, crearEscenario, escribirNota, gitDirecto, rutaGit } from './helpers.ts';
import type { Escenario } from './helpers.ts';

async function existe(ruta: string): Promise<boolean> {
  try {
    await access(ruta);
    return true;
  } catch {
    return false;
  }
}

describe('consultas de git sobre un repo real', () => {
  let esc: Escenario;
  let consultas: ConsultasGit;
  const crear = (cambios: { git?: string | null; timeoutMs?: number } = {}): ConsultasGit =>
    crearConsultasGit({ git: rutaGit(), repo: esc.repo, timeoutMs: 5000, ...cambios });

  beforeEach(async () => {
    esc = await crearEscenario();
    await convertirEnRepoGit(esc.repo); // el escenario trae un .git falso
    await escribirNota(esc.repo, 'docs/a.md', 'a\n');
    commitear(esc.repo, 'feat: base');
    consultas = crear();
  });
  afterEach(async () => {
    await esc.limpiar();
  });

  test('resolver entrega el commit completo de una referencia y rechaza lo que no lo es', async () => {
    const cabeza = gitDirecto(esc.repo, 'rev-parse', 'HEAD').trim();
    assert.equal(await consultas.resolver('HEAD'), cabeza);
    assert.equal(await consultas.resolver('main'), cabeza);
    gitDirecto(esc.repo, 'tag', 'v1.0.0');
    assert.equal(await consultas.resolver('v1.0.0'), cabeza, 'un tag apunta a su commit');
    gitDirecto(esc.repo, '-c', 'tag.gpgsign=false', 'tag', '-a', 'v2.0.0', '-m', 'anotado');
    assert.equal(await consultas.resolver('v2.0.0'), cabeza, 'un tag anotado se resuelve al commit y no al objeto del tag');
    assert.equal(await codigoDe(consultas.resolver('ref-que-no-existe')), 'GIT');
    assert.equal(await codigoDe(consultas.resolver('--output=x')), 'REF_INVALIDA');
    assert.equal(await codigoDe(consultas.resolver('main..develop')), 'REF_INVALIDA');
  });

  test('cabezaCorta y ramaActual describen dónde está el repo', async () => {
    assert.equal(await consultas.cabezaCorta(), gitDirecto(esc.repo, 'rev-parse', '--short', 'HEAD').trim());
    assert.equal(await consultas.ramaActual(), 'main');
  });

  test('tagsDeVersion lista los tags v* y existeTag pregunta por uno exacto', async () => {
    assert.deepEqual(await consultas.tagsDeVersion(), []);
    for (const tag of ['v1.0.0', 'v1.1.0', 'otro']) gitDirecto(esc.repo, 'tag', tag);
    assert.deepEqual(await consultas.tagsDeVersion(), ['v1.0.0', 'v1.1.0']);
    assert.equal(await consultas.existeTag('v1.1.0'), true);
    assert.equal(await consultas.existeTag('otro'), true, 'existeTag no se limita a los tags de versión');
    assert.equal(await consultas.existeTag('v9.9.9'), false);
    assert.equal(await codigoDe(consultas.existeTag('v1.*')), 'REF_INVALIDA', 'un patrón no es un nombre de tag');
    assert.equal(await codigoDe(consultas.existeTag('-l')), 'REF_INVALIDA');
  });

  test('commitsEntre entrega sha, asunto y cuerpo, del más nuevo al más viejo', async () => {
    gitDirecto(esc.repo, 'tag', 'v1.0.0');
    await escribirNota(esc.repo, 'docs/b.md', 'b\n');
    gitDirecto(esc.repo, 'add', '-A');
    gitDirecto(esc.repo, '-c', 'commit.gpgsign=false', 'commit', '--no-verify', '-m', 'feat!: rompe todo', '-m', 'BREAKING CHANGE: cambia el formato\nsegunda línea');
    await escribirNota(esc.repo, 'docs/c.md', 'c\n');
    commitear(esc.repo, 'fix: arregla c');
    const commits = await consultas.commitsEntre('v1.0.0', 'HEAD');
    assert.deepEqual(commits.map((c) => c.asunto), ['fix: arregla c', 'feat!: rompe todo']);
    assert.match(commits[0]?.sha ?? '', /^[0-9a-f]{40}$/);
    assert.equal(commits[0]?.cuerpo, '');
    assert.equal(commits[1]?.cuerpo, 'BREAKING CHANGE: cambia el formato\nsegunda línea');
    assert.deepEqual(await consultas.commitsEntre('HEAD', 'HEAD'), []);
  });

  test('archivosCambiados lista las rutas que cambian entre dos referencias', async () => {
    gitDirecto(esc.repo, 'tag', 'v1.0.0');
    await escribirNota(esc.repo, 'docs/b.md', 'b\n');
    await escribirNota(esc.repo, 'api/x.ts', 'export {};\n');
    commitear(esc.repo, 'feat: b y x');
    assert.deepEqual((await consultas.archivosCambiados('v1.0.0', 'HEAD')).sort(), ['api/x.ts', 'docs/b.md']);
    assert.deepEqual(await consultas.archivosCambiados('HEAD', 'HEAD'), []);
  });

  test('archivosCambiados no agrupa un renombre: lista la ruta vieja y la nueva', async () => {
    gitDirecto(esc.repo, 'tag', 'v1.0.0');
    gitDirecto(esc.repo, 'mv', 'docs/a.md', 'docs/renombrada.md');
    commitear(esc.repo, 'docs: renombra a');
    assert.deepEqual((await consultas.archivosCambiados('v1.0.0', 'HEAD')).sort(), ['docs/a.md', 'docs/renombrada.md']);
  });

  test('archivosConMarcador devuelve las rutas que lo contienen; sin coincidencias no es un fallo, un objeto ilegible sí', async () => {
    await escribirNota(esc.repo, 'db/migrations/1_drop.sql', '-- destructiva\ndrop table x;\n');
    await escribirNota(esc.repo, 'db/migrations/2_ok.sql', 'select 1;\n');
    await escribirNota(esc.repo, 'docs/nota.sql', '-- destructiva\n');
    commitear(esc.repo, 'feat(db): migraciones');
    assert.deepEqual(await consultas.archivosConMarcador('HEAD', '-- destructiva', 'db/migrations'), ['db/migrations/1_drop.sql']);
    assert.deepEqual(await consultas.archivosConMarcador('HEAD', 'NO-EXISTE-XYZ', 'db/migrations'), []);
    assert.equal(await codigoDe(consultas.archivosConMarcador('ref-que-no-existe', 'x', 'db/migrations')), 'GIT', 'un ref inexistente termina con 128');
    // git grep termina con 1 tanto sin coincidencias como cuando no pudo leer un objeto: solo lo distingue stderr.
    const blob = gitDirecto(esc.repo, 'rev-parse', 'HEAD:db/migrations/1_drop.sql').trim();
    const objeto = path.join(esc.repo, '.git', 'objects', blob.slice(0, 2), blob.slice(2));
    await chmod(objeto, 0o666); // git guarda sus objetos como solo lectura
    await rm(objeto);
    assert.equal(await codigoDe(consultas.archivosConMarcador('HEAD', '-- destructiva', 'db/migrations')), 'GIT');
  });

  test('ultimoCambioDesde da el último commit que tocó la ruta después del SHA, o nada', async () => {
    const sha = gitDirecto(esc.repo, 'rev-parse', '--short', 'HEAD').trim();
    assert.equal(await consultas.ultimoCambioDesde(sha, 'docs/a.md'), '');
    await escribirNota(esc.repo, 'docs/a.md', 'a2\n');
    commitear(esc.repo, 'docs: cambia a');
    assert.match(await consultas.ultimoCambioDesde(sha, 'docs/a.md'), /^[0-9a-f]{7,} \d{4}-\d{2}-\d{2} docs: cambia a$/);
    assert.equal(await consultas.ultimoCambioDesde(sha, 'docs/otra.md'), '');
    assert.equal(await codigoDe(consultas.ultimoCambioDesde('abcdef1', 'docs/a.md')), 'GIT', 'un SHA que no está en el clon');
  });

  test('cambiosSinCommit cuenta los archivos con cambios y archivoConCambios pregunta por uno', async () => {
    assert.equal(await consultas.cambiosSinCommit(), 0);
    assert.equal(await consultas.archivoConCambios('docs/a.md'), false);
    await writeFile(path.join(esc.repo, 'docs', 'a.md'), 'cambiado\n', 'utf8');
    await escribirNota(esc.repo, 'docs/nuevo.md', 'n\n');
    assert.equal(await consultas.cambiosSinCommit(), 2);
    assert.equal(await consultas.archivoConCambios('docs/a.md'), true);
    assert.equal(await consultas.archivoConCambios('docs/nuevo.md'), true);
    assert.equal(await consultas.archivoConCambios('docs/b.md'), false);
  });

  test('las rutas se toman literalmente: ni comodines ni sintaxis de pathspec', async () => {
    await writeFile(path.join(esc.repo, 'docs', 'a.md'), 'cambiado\n', 'utf8');
    assert.equal(await consultas.archivoConCambios('docs/*'), false, 'un comodín no es una ruta');
    assert.equal(await consultas.archivoConCambios(':(top)docs/a.md'), false, 'la sintaxis de pathspec de git no se interpreta');
    assert.deepEqual(await consultas.archivosConMarcador('HEAD', 'a', 'docs/*'), []);
  });

  test('contarCommitsEntre cuenta lo que hay en un lado y no en el otro', async () => {
    gitDirecto(esc.repo, 'branch', 'develop');
    await escribirNota(esc.repo, 'docs/b.md', 'b\n');
    commitear(esc.repo, 'docs: b');
    assert.equal(await consultas.contarCommitsEntre('develop', 'main'), 1);
    assert.equal(await consultas.contarCommitsEntre('main', 'develop'), 0);
    assert.equal(await codigoDe(consultas.contarCommitsEntre('main', 'no-existe')), 'GIT');
  });

  test('commitsRecientes entrega «sha fecha asunto», del más nuevo al más viejo y con tope', async () => {
    await escribirNota(esc.repo, 'docs/b.md', 'b\n');
    commitear(esc.repo, 'docs: b');
    const dos = await consultas.commitsRecientes(2);
    assert.equal(dos.length, 2);
    assert.match(dos[0] ?? '', /^[0-9a-f]{7,} \d{4}-\d{2}-\d{2} docs: b$/);
    assert.equal((await consultas.commitsRecientes(1)).length, 1);
    assert.equal(await codigoDe(consultas.commitsRecientes(Number.NaN)), 'ARGUMENTOS');
    assert.equal(await codigoDe(consultas.commitsRecientes(0)), 'ARGUMENTOS');
  });

  test('sin git_path cada consulta responde GIT_NO_CONFIGURADO', async () => {
    const sinGit = crear({ git: null });
    const consultasSinGit = [
      () => sinGit.resolver('HEAD'),
      () => sinGit.cabezaCorta(),
      () => sinGit.ramaActual(),
      () => sinGit.tagsDeVersion(),
      () => sinGit.existeTag('v1.0.0'),
      () => sinGit.commitsEntre('main', 'HEAD'),
      () => sinGit.commitsRecientes(1),
      () => sinGit.contarCommitsEntre('main', 'HEAD'),
      () => sinGit.archivosCambiados('main', 'HEAD'),
      () => sinGit.archivosConMarcador('HEAD', 'x', 'db'),
      () => sinGit.ultimoCambioDesde('abcdef1', 'docs/a.md'),
      () => sinGit.cambiosSinCommit(),
      () => sinGit.archivoConCambios('docs/a.md'),
    ];
    for (const consulta of consultasSinGit) assert.equal(await codigoDe(consulta()), 'GIT_NO_CONFIGURADO');
  });

  test('toda consulta con referencias rechaza las que parecen opciones antes de lanzar git', async () => {
    const sinGit = crear({ git: null }); // si la validación no fuera primero, respondería GIT_NO_CONFIGURADO
    const mala = '--output=x';
    const conReferencia = [
      () => sinGit.resolver(mala),
      () => sinGit.existeTag(mala),
      () => sinGit.commitsEntre(mala, 'HEAD'),
      () => sinGit.commitsEntre('HEAD', mala),
      () => sinGit.contarCommitsEntre(mala, 'HEAD'),
      () => sinGit.contarCommitsEntre('HEAD', mala),
      () => sinGit.archivosCambiados(mala, 'HEAD'),
      () => sinGit.archivosCambiados('HEAD', mala),
      () => sinGit.archivosConMarcador(mala, 'x', 'docs'),
      () => sinGit.ultimoCambioDesde(mala, 'docs/a.md'),
    ];
    for (const consulta of conReferencia) assert.equal(await codigoDe(consulta()), 'REF_INVALIDA');
  });

  // Con 1 ms git no alcanza a terminar: la prueba supone que lanzar un proceso tarda más que eso.
  test('un plazo agotado es un fallo, también en la consulta que acepta la salida 1', async () => {    const sinTiempo = crear({ timeoutMs: 1 });
    assert.equal(await codigoDe(sinTiempo.archivosConMarcador('HEAD', 'NO-EXISTE-XYZ', 'docs')), 'GIT');
    assert.equal(await codigoDe(sinTiempo.resolver('HEAD')), 'GIT');
  });

  test('las referencias que parecen opciones se rechazan', () => {
    assert.equal(validarRef('main'), 'main');
    assert.throws(() => validarRef('--output=x'), { codigo: 'REF_INVALIDA' });
    assert.throws(() => validarRef('main..develop'), { codigo: 'REF_INVALIDA' });
  });

  // Las ramas de plazo y de señal no se pueden provocar de forma portable con git real: el código con el que
  // termina un proceso matado depende del sistema y de la versión de Node. Se prueban con los errores que
  // execFile entrega.
  test('salidaAceptada: solo una salida declarada, sin plazo ni señal ni nada en stderr, cuenta como válida', () => {
    const conError = (cambios: object) => salidaAceptada({ code: 1, signal: null, killed: false, stdout: 'x', ...cambios }, [1]);
    assert.equal(conError({}), 'x', 'salida declarada y terminó sola');
    assert.equal(conError({ stdout: undefined }), '', 'sin stdout, vacío');
    assert.equal(conError({ stderr: '' }), 'x', 'stderr vacío: git no protestó');
    assert.equal(conError({ stderr: "error: 'HEAD:db/m.sql': unable to read 2c2766bf" }), null, 'git grep también termina con 1 si no pudo leer un objeto');
    assert.equal(conError({ code: 128 }), null, 'código no declarado');
    assert.equal(conError({ code: 'ENOENT' }), null, 'un código de sistema no es una salida');
    assert.equal(conError({ code: null }), null, 'sin código');
    assert.equal(conError({ killed: true }), null, 'matado por el plazo, aunque su código sea uno declarado');
    assert.equal(conError({ signal: 'SIGTERM' }), null, 'terminado por una señal, aunque su código sea uno declarado');
    assert.equal(salidaAceptada({ code: 1, stdout: 'x' }, []), null, 'con la lista vacía nada es válido');
    assert.equal(salidaAceptada({ code: 1, stdout: 'x' }), null, 'sin lista nada es válido');
    assert.equal(salidaAceptada(null, [1]), null, 'lo que no es un error de execFile no es una salida');
  });

  test('git no reescribe el índice', async () => {
    const indice = path.join(esc.repo, '.git', 'index');
    const huella = async (): Promise<string> => createHash('sha256').update(await readFile(indice)).digest('hex');
    const antes = await huella();
    const ahora = new Date();
    await utimes(path.join(esc.repo, 'docs', 'a.md'), ahora, ahora); // mismo contenido, otra fecha: git querría refrescar el índice
    await consultas.cambiosSinCommit();
    assert.equal(await huella(), antes);
  });

  test('una configuración de git que ejecuta programas no se ejecuta', async (t) => {
    const testigo = path.join(esc.base, 'testigo-fsmonitor.txt');
    const gancho = path.join(esc.base, 'gancho.sh');
    await writeFile(gancho, `#!/bin/sh\necho x > "${testigo.replaceAll('\\', '/')}"\n`, 'utf8');
    gitDirecto(esc.repo, 'config', 'core.fsmonitor', gancho.replaceAll('\\', '/'));
    // Control: sin nuestras protecciones, ¿git ejecuta el gancho en este equipo?
    try {
      gitDirecto(esc.repo, 'status');
    } catch {
      // puede fallar; solo importa si el gancho corrió
    }
    if (!(await existe(testigo))) {
      t.skip('No ejecutada: en este equipo git no ejecutó el gancho de control');
      return;
    }
    await rm(testigo);
    await consultas.cambiosSinCommit();
    assert.equal(await existe(testigo), false);
  });
});
