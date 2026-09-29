import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { aplicarCambio } from '../src/aplicar.ts';
import { validarArranque } from '../src/arranque.ts';
import type { Contexto } from '../src/arranque.ts';
import type { Commit, ConsultasGit } from '../src/git.ts';
import { crearGuardia } from '../src/guardia.ts';
import { indexar } from '../src/notas.ts';
import { clasificar, prepararBorradorRelease, proponer, siguienteVersion, ultimoTag } from '../src/release.ts';
import type { DatosRelease } from '../src/release.ts';
import { codigoDe, commitear, convertirEnRepoGit, crearEscenario, escribirNota, gitDirecto, notaContadores, rutaGit } from './helpers.ts';
import type { Escenario } from './helpers.ts';
import { consultasGitFalsas, falloDeGit } from './consultas-git-falsas.ts';

describe('clasificación y versiones', () => {
  test('Conventional Commits como señales', () => {
    const c = clasificar([
      { sha: '1', asunto: 'fix: a', cuerpo: '' },
      { sha: '2', asunto: 'feat(db): b', cuerpo: '' },
      { sha: '3', asunto: 'feat!: c', cuerpo: '' },
      { sha: '4', asunto: 'chore: d', cuerpo: 'BREAKING CHANGE: se retira X' },
      { sha: '5', asunto: 'actualiza cosas', cuerpo: '' },
    ]);
    assert.deepEqual([c.major.length, c.minor.length, c.patch.length, c.otros.length, c.noConvencionales.length], [2, 1, 1, 0, 1]);
  });

  test('último tag y siguiente versión', () => {
    assert.equal(ultimoTag(['v1.2.0', 'v1.10.0', 'v1.9.3', 'otro']), 'v1.10.0');
    assert.equal(siguienteVersion(null, 'linea-base'), '1.0.0');
    assert.equal(siguienteVersion('v1.2.3', 'patch'), '1.2.4');
    assert.equal(siguienteVersion('v1.2.3', 'minor'), '1.3.0');
    assert.equal(siguienteVersion('v1.2.3', 'major'), '2.0.0');
  });
});

describe('propuesta y borrador sobre un repo real', () => {
  let esc: Escenario;
  let ctx: Contexto;

  beforeEach(async () => {
    esc = await crearEscenario();
    await convertirEnRepoGit(esc.repo);
    await escribirNota(esc.repo, 'docs/a.md', 'a\n');
    commitear(esc.repo, 'feat: base');
    gitDirecto(esc.repo, 'branch', 'develop');
    await esc.escribirConfig({
      git_path: rutaGit(),
      project_name: 'Demo App',
      limites: { escrituras_por_minuto: 60 },
      release: {
        rama_desarrollo: 'develop',
        lista_verificacion: ['El deploy de {head} terminó en verde'],
        migraciones: { carpeta: 'db/migrations', marcador_destructivo: '-- destructiva' },
        senales: [{ prefijo: 'api/', mensaje: 'Cambió la API pública: revisa los contratos.' }],
      },
    });
    await escribirNota(esc.proyecto, '_contadores.md', notaContadores());
    await mkdir(path.join(esc.proyecto, 'Releases'));
    const estado = await validarArranque(['--config', esc.rutaConfig], {});
    assert.ok(estado.ok, 'el escenario debería arrancar');
    ctx = estado.ctx;
  });
  afterEach(async () => {
    await esc.limpiar();
  });

  test('sin tags propone la línea base y no crea tags', async () => {
    const antes = gitDirecto(esc.repo, 'tag', '--list');
    const p = await proponer(ctx, 'main');
    assert.equal(p.bump, 'linea-base');
    assert.equal(p.version, '1.0.0');
    assert.equal(gitDirecto(esc.repo, 'tag', '--list'), antes);
  });

  test('una migración destructiva sube a major aunque el commit diga feat', async () => {
    gitDirecto(esc.repo, 'tag', 'v1.0.0');
    await escribirNota(esc.repo, 'db/migrations/20260201000000_drop.sql', '-- destructiva\ndrop table x;\n');
    commitear(esc.repo, 'feat(db): retira x');
    const p = await proponer(ctx, 'main');
    assert.equal(p.bump, 'major');
    assert.equal(p.version, '2.0.0');
    assert.ok(p.motivos.some((m) => m.includes('destructivas')));
  });

  test('el marcador destructivo fuera de la carpeta de migraciones no cuenta', async () => {
    gitDirecto(esc.repo, 'tag', 'v1.0.0');
    await escribirNota(esc.repo, 'docs/nota.sql', '-- destructiva\n');
    commitear(esc.repo, 'fix: nota');
    assert.equal((await proponer(ctx, 'main')).bump, 'patch');
  });

  test('las señales del proyecto se avisan', async () => {
    gitDirecto(esc.repo, 'tag', 'v1.0.0');
    await escribirNota(esc.repo, 'api/pedidos.ts', 'export {};\n');
    commitear(esc.repo, 'feat: pedidos');
    const p = await proponer(ctx, 'main');
    assert.equal(p.bump, 'minor');
    assert.ok(p.motivos.includes('Cambió la API pública: revisa los contratos.'));
    assert.deepEqual(p.divergencia?.principalNoEnDesarrollo, 1);
  });

  test('un fix solo propone patch', async () => {
    gitDirecto(esc.repo, 'tag', 'v1.0.0');
    await escribirNota(esc.repo, 'docs/b.md', 'b\n');
    commitear(esc.repo, 'fix: corrige b');
    assert.equal((await proponer(ctx, 'main')).version, '1.0.1');
  });

  test('el borrador se crea con estado Borrador y «Publicada» exige el tag', async () => {
    const g = crearGuardia(ctx.proyecto, ctx.config.limites);
    const head = gitDirecto(esc.repo, 'rev-parse', '--short', 'HEAD').trim();
    const datos: DatosRelease = {
      version: '1.0.0',
      titulo: 'Demo App v1.0.0 — línea base',
      resumen: 'Primera versión etiquetada.',
      secciones: {},
      migraciones: [],
      bump: 'linea-base',
      base_ref: 'ninguno',
      head_ref: head,
      release_status: 'Borrador',
      fuentes: [],
    };
    const p = await prepararBorradorRelease(ctx, g, await indexar(g, ctx.config), datos);
    await aplicarCambio(ctx, g, p.confirmacion);
    const texto = await readFile(path.join(ctx.proyecto, 'Releases', 'DEM-R-v1.0.0.md'), 'utf8');
    assert.match(texto, new RegExp(`- \\[ \\] El deploy de ${head} terminó en verde`));
    assert.match(texto, /- \[ \] Revisaste la divergencia entre main y develop/);
    assert.match(texto, new RegExp(`git tag -a v1\\.0\\.0 ${head} -m "Demo App v1\\.0\\.0"`));
    const nota = (await indexar(g, ctx.config)).notas.find((n) => n.id === 'DEM-R-v1.0.0') ?? assert.fail('falta el release');
    assert.equal(nota.datos.release_status, 'Borrador');
    assert.equal(nota.datos.tag_verified, false);
    const publicada = { ...datos, release_status: 'Publicada' as const, version_esperada: nota.version };
    assert.equal(await codigoDe(prepararBorradorRelease(ctx, g, await indexar(g, ctx.config), publicada)), 'TAG_NO_VERIFICADO');
  });

  test('el texto libre del borrador se limpia al entrar: un marcador de bloque se rechaza y nombra el campo', async () => {
    const g = crearGuardia(ctx.proyecto, ctx.config.limites);
    const head = gitDirecto(esc.repo, 'rev-parse', '--short', 'HEAD').trim();
    const datos: DatosRelease = {
      version: '1.0.0',
      titulo: 'Demo App v1.0.0',
      resumen: 'Primera versión.',
      secciones: { corregido: ['bien', 'mal %% asyncdv:fin %%'] },
      migraciones: [],
      bump: 'linea-base',
      base_ref: 'ninguno',
      head_ref: head,
      release_status: 'Borrador',
      fuentes: [],
    };
    await assert.rejects(prepararBorradorRelease(ctx, g, await indexar(g, ctx.config), datos), {
      codigo: 'CAMPO_INVALIDO',
      message: '«secciones.corregido[1]» no puede contener marcadores «%% asyncdv:».',
    });
  });

  test('actualizar el borrador cambia propiedades y bloque, conserva lo escrito fuera y exige la versión leída', async () => {
    const g = crearGuardia(ctx.proyecto, ctx.config.limites);
    const head = gitDirecto(esc.repo, 'rev-parse', '--short', 'HEAD').trim();
    const datos: DatosRelease = {
      version: '1.0.0',
      titulo: 'Demo App v1.0.0',
      resumen: 'Primera versión.',
      secciones: {},
      migraciones: [],
      bump: 'linea-base',
      base_ref: 'ninguno',
      head_ref: head,
      release_status: 'Borrador',
      fuentes: [],
    };
    await aplicarCambio(ctx, g, (await prepararBorradorRelease(ctx, g, await indexar(g, ctx.config), datos)).confirmacion);
    const ruta = path.join(ctx.proyecto, 'Releases', 'DEM-R-v1.0.0.md');
    await writeFile(ruta, (await readFile(ruta, 'utf8')).replace('## Pasos manuales\n(complétalo tú)', '## Pasos manuales\nAvisar a soporte.'), 'utf8');
    const nota = (await indexar(g, ctx.config)).notas.find((n) => n.id === 'DEM-R-v1.0.0') ?? assert.fail('falta el release');
    assert.equal(await codigoDe(prepararBorradorRelease(ctx, g, await indexar(g, ctx.config), datos)), 'CONFLICTO', 'sin version_esperada no se actualiza');
    const p = await prepararBorradorRelease(ctx, g, await indexar(g, ctx.config), {
      ...datos,
      titulo: 'Demo App v1.0.0 — lista',
      resumen: 'Revisada.',
      secciones: { corregido: ['Un bug'] },
      release_status: 'Lista',
      version_esperada: nota.version,
    });
    assert.match(p.vistaPrevia, /^Cambios en Releases\/DEM-R-v1\.0\.0\.md:\n/);
    await aplicarCambio(ctx, g, p.confirmacion);
    const texto = await readFile(ruta, 'utf8');
    assert.match(texto, /^title: Demo App v1\.0\.0 — lista$/m);
    assert.match(texto, /^release_status: Lista$/m);
    assert.match(texto, /## Corregido\n- Un bug\n/);
    assert.match(texto, /## Pasos manuales\nAvisar a soporte\./);
    assert.doesNotMatch(texto, /Primera versión\./);
    assert.equal(await codigoDe(prepararBorradorRelease(ctx, g, await indexar(g, ctx.config), { ...datos, version_esperada: nota.version })), 'CONFLICTO', 'la versión leída antes de aplicar ya no vale');
  });
});

describe('proponer con un git de mentira', () => {
  let esc: Escenario;
  let ctx: Contexto;
  const commit = (asunto: string, cuerpo = ''): Commit => ({ sha: 'b'.repeat(40), asunto, cuerpo });
  // Un git donde HEAD está en v1.0.0 y no cambió nada, salvo lo que cada prueba declara.
  const conGit = (respuestas: Partial<ConsultasGit>): Contexto => ({
    ...ctx,
    consultasGit: consultasGitFalsas({
      resolver: async () => 'a'.repeat(40),
      tagsDeVersion: async () => ['v1.0.0'],
      commitsEntre: async () => [],
      archivosCambiados: async () => [],
      archivosConMarcador: async () => [],
      ...respuestas,
    }),
  });

  beforeEach(async () => {
    esc = await crearEscenario();
    await esc.escribirConfig({
      release: {
        migraciones: { carpeta: 'db/migrations', marcador_destructivo: '-- destructiva' },
        senales: [{ prefijo: 'api/', mensaje: 'Cambió la API pública: revisa los contratos.' }],
      },
    });
    const estado = await validarArranque(['--config', esc.rutaConfig], {});
    assert.ok(estado.ok, 'el escenario debería arrancar');
    ctx = estado.ctx;
  });
  afterEach(async () => {
    await esc.limpiar();
  });

  test('sin tags propone la línea base', async () => {
    const p = await proponer(conGit({ tagsDeVersion: async () => [] }), 'main');
    assert.deepEqual([p.bump, p.version, p.base, p.clasificacion], ['linea-base', '1.0.0', null, null]);
  });

  test('la base es el tag de versión más alto y no el último de la lista', async () => {
    let baseUsada = '';
    const p = await proponer(
      conGit({
        tagsDeVersion: async () => ['v1.9.0', 'v1.10.0', 'v1.2.0'],
        commitsEntre: async (base) => {
          baseUsada = base;
          return [commit('fix: a')];
        },
      }),
      'main',
    );
    assert.equal(baseUsada, 'v1.10.0');
    assert.equal(p.version, '1.10.1');
  });

  test('el bump sale de los commits', async () => {
    const casos: [Commit[], string, string][] = [
      [[commit('fix: a')], 'patch', '1.0.1'],
      [[commit('fix: a'), commit('feat: b')], 'minor', '1.1.0'],
      [[commit('feat!: a')], 'major', '2.0.0'],
      [[commit('chore: a', 'BREAKING CHANGE: rompe el formato')], 'major', '2.0.0'],
      [[commit('chore: mantenimiento')], 'patch', '1.0.1'],
      [[], 'ninguno', '1.0.0'],
    ];
    for (const [commits, bump, version] of casos) {
      const p = await proponer(conGit({ commitsEntre: async () => commits }), 'main');
      assert.deepEqual([p.bump, p.version], [bump, version], commits.map((c) => c.asunto).join(', ') || 'sin commits');
    }
  });

  test('una migración destructiva nueva sube a major aunque el commit diga feat; una que ya estaba no cuenta', async () => {
    const nueva = await proponer(
      conGit({
        commitsEntre: async () => [commit('feat(db): retira x')],
        archivosCambiados: async () => ['db/migrations/2_drop.sql'],
        archivosConMarcador: async () => ['db/migrations/1_vieja.sql', 'db/migrations/2_drop.sql'],
      }),
      'main',
    );
    assert.equal(nueva.bump, 'major');
    assert.ok(nueva.motivos.some((m) => m.includes('db/migrations/2_drop.sql')));
    assert.ok(!nueva.motivos.some((m) => m.includes('1_vieja')));
    const vieja = await proponer(conGit({ commitsEntre: async () => [commit('fix: a')], archivosConMarcador: async () => ['db/migrations/1_vieja.sql'] }), 'main');
    assert.equal(vieja.bump, 'patch');
  });

  test('las señales del proyecto se avisan una sola vez y los commits sin formato también', async () => {
    const p = await proponer(
      conGit({ commitsEntre: async () => [commit('arreglé cosas'), commit('feat: b')], archivosCambiados: async () => ['api/a.ts', 'api/b.ts'] }),
      'main',
    );
    assert.equal(p.motivos.filter((m) => m === 'Cambió la API pública: revisa los contratos.').length, 1);
    assert.ok(p.motivos.includes('1 commit(s) no siguen Conventional Commits: revísalos a mano.'));
  });

  test('avisa que un merge --ff-only fallará solo si la rama principal va por delante de la de desarrollo', async () => {
    await esc.escribirConfig({ release: { rama_desarrollo: 'develop' } });
    const estado = await validarArranque(['--config', esc.rutaConfig], {});
    assert.ok(estado.ok);
    const aviso = 'main va por delante de develop: un merge --ff-only de develop a main fallará. Revísalo antes del tag.';
    const proponerCon = (contar: ConsultasGit['contarCommitsEntre'], tags: string[] = ['v1.0.0']) =>
      proponer(
        {
          ...estado.ctx,
          consultasGit: consultasGitFalsas({
            resolver: async () => 'a'.repeat(40),
            tagsDeVersion: async () => tags,
            commitsEntre: async () => [],
            archivosCambiados: async () => [],
            contarCommitsEntre: contar,
          }),
        },
        'main',
      );
    const adelantada: ConsultasGit['contarCommitsEntre'] = async (desde) => (desde === 'develop' ? 2 : 0);
    assert.deepEqual((await proponerCon(adelantada)).avisos, [aviso]);
    assert.deepEqual((await proponerCon(async () => 0)).avisos, []);
    assert.deepEqual((await proponerCon(falloDeGit)).avisos, [], 'sin poder contar no se avisa');
    assert.deepEqual((await proponerCon(adelantada, [])).avisos, [aviso], 'también en la línea base');
  });

  test('sin rama de desarrollo la propuesta no trae avisos', async () => {
    assert.deepEqual((await proponer(conGit({}), 'main')).avisos, []);
  });

  test('cualquier consulta que falla hace fallar la propuesta en vez de degradarla', async () => {
    const fallos: [string, Partial<ConsultasGit>][] = [
      ['resolver', { resolver: falloDeGit }],
      ['tagsDeVersion', { tagsDeVersion: falloDeGit }],
      ['commitsEntre', { commitsEntre: falloDeGit }],
      ['archivosCambiados', { archivosCambiados: falloDeGit }],
      ['archivosConMarcador', { archivosConMarcador: falloDeGit }],
    ];
    for (const [nombre, fallo] of fallos) {
      assert.equal(await codigoDe(proponer(conGit({ commitsEntre: async () => [commit('feat: a')], ...fallo }), 'main')), 'GIT', nombre);
    }
  });

  test('proponer resuelve la referencia una vez y pasa el SHA a las demás consultas', async () => {
    const llamadas: string[] = [];
    const sha = 'a'.repeat(40);
    const p = await proponer(
      conGit({
        resolver: async (ref) => {
          llamadas.push(`resolver ${ref}`);
          return sha;
        },
        commitsEntre: async (base, head) => {
          llamadas.push(`commitsEntre ${base} ${head}`);
          return [commit('feat: a')];
        },
        archivosCambiados: async (base, head) => {
          llamadas.push(`archivosCambiados ${base} ${head}`);
          return [];
        },
        archivosConMarcador: async (ref, marcador, carpeta) => {
          llamadas.push(`archivosConMarcador ${ref} ${marcador} ${carpeta}`);
          return [];
        },
      }),
      'develop',
    );
    assert.deepEqual(llamadas, [
      'resolver develop',
      `commitsEntre v1.0.0 ${sha}`,
      `archivosCambiados v1.0.0 ${sha}`,
      `archivosConMarcador ${sha} -- destructiva db/migrations`,
    ]);
    assert.equal(p.head, sha);
  });
});
