import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { aplicarCambio } from '../src/aplicar.ts';
import { validarArranque } from '../src/arranque.ts';
import type { Contexto } from '../src/arranque.ts';
import { crearGuardia } from '../src/guardia.ts';
import { indexar } from '../src/notas.ts';
import { clasificar, prepararBorradorRelease, proponer, siguienteVersion, ultimoTag } from '../src/release.ts';
import type { DatosRelease } from '../src/release.ts';
import { commitear, convertirEnRepoGit, crearEscenario, escribirNota, gitDirecto, notaContadores, rutaGit } from './helpers.ts';
import type { Escenario } from './helpers.ts';

async function codigoDe(promesa: Promise<unknown>): Promise<string> {
  try {
    await promesa;
    return 'OK';
  } catch (error) {
    return (error as { codigo?: string }).codigo ?? 'OTRO';
  }
}

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
});
