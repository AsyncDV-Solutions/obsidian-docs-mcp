import assert from 'node:assert/strict';
import { mkdir, symlink } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { validarArranque } from '../src/arranque.ts';
import type { Contexto } from '../src/arranque.ts';
import { ErrorMcp } from '../src/errores.ts';
import { divergencia, inventario, leerArchivoRepo, patronARegex, resumenGit } from '../src/repo.ts';
import { codigoDe, commitear, convertirEnRepoGit, crearEscenario, escribirNota, gitDirecto, rutaGit } from './helpers.ts';
import type { Escenario } from './helpers.ts';
import { consultasGitFalsas, falloDeGit } from './consultas-git-falsas.ts';

describe('repo en solo lectura', () => {
  let esc: Escenario;
  let ctx: Contexto;

  beforeEach(async () => {
    esc = await crearEscenario();
    await convertirEnRepoGit(esc.repo); // el escenario trae un .git falso
    await escribirNota(esc.repo, 'docs/a.md', '# Doc A\n');
    await escribirNota(esc.repo, '.env', 'SECRETO=TESTIGO-ENV\n');
    await escribirNota(esc.repo, 'config/clientes.json', '{"TESTIGO":"CLIENTES"}\n');
    await escribirNota(esc.repo, 'db/migrations/20260101000000_x.sql', 'select 1;\n');
    await escribirNota(esc.repo, 'package.json', '{"name":"demo"}\n');
    await escribirNota(esc.repo, '.github/prompts/autofix.md', '# Prompt del agente\n');
    await escribirNota(esc.repo, '.github/scripts/validar.mjs', 'export {};\n');
    await escribirNota(esc.repo, '.github/CODEOWNERS', '* @TESTIGO-OWNERS\n');
    commitear(esc.repo, 'feat: base');
    gitDirecto(esc.repo, 'branch', 'develop');
    await esc.escribirConfig({ git_path: rutaGit() });
    const estado = await validarArranque(['--config', esc.rutaConfig], {});
    assert.ok(estado.ok, 'el escenario debería arrancar');
    ctx = estado.ctx;
  });
  afterEach(async () => {
    await esc.limpiar();
  });

  test('sin git_path el resumen responde GIT_NO_CONFIGURADO', async () => {
    await esc.escribirConfig();
    const estado = await validarArranque(['--config', esc.rutaConfig], {});
    assert.ok(estado.ok);
    assert.equal(await codigoDe(resumenGit(estado.ctx)), 'GIT_NO_CONFIGURADO');
  });

  // git de Homebrew (macOS) es un enlace: /opt/homebrew/bin/git → ../Cellar/git/<versión>/bin/git.
  test('git_path puede ser un enlace: arranca y git responde con el archivo real', async (t) => {
    const enlace = path.join(esc.base, 'bin', process.platform === 'win32' ? 'git.exe' : 'git');
    await mkdir(path.dirname(enlace));
    try {
      await symlink(rutaGit(), enlace, 'file');
    } catch {
      t.skip('No ejecutada: este sistema no permite crear symlinks sin privilegios');
      return;
    }
    await esc.escribirConfig({ git_path: enlace });
    const estado = await validarArranque(['--config', esc.rutaConfig], {});
    assert.ok(estado.ok, JSON.stringify(estado.ok ? [] : estado.problemas));
    assert.match(await estado.ctx.consultasGit.resolver('HEAD'), /^[0-9a-f]{40}$/);
  });

  test('git_path que es una carpeta o que no existe se rechaza', async () => {
    const casos = [
      [esc.base, 'GIT_NO_ARCHIVO'],
      [path.join(esc.base, 'no-existe'), 'RUTA_NO_EXISTE'],
    ];
    for (const [ruta, codigo] of casos) {
      await esc.escribirConfig({ git_path: ruta });
      const estado = await validarArranque(['--config', esc.rutaConfig], {});
      assert.deepEqual(estado.ok ? [] : estado.problemas.map((p) => p.codigo), [codigo], ruta);
    }
  });

  test('el inventario muestra las categorías y nunca los excluidos', async () => {
    const texto = JSON.stringify(await inventario(ctx));
    assert.match(texto, /docs\/a\.md/);
    assert.match(texto, /20260101000000_x\.sql/);
    assert.doesNotMatch(texto, /\.env|clientes\.json/);
  });

  test('solo se lee el contenido de las categorías permitidas', async () => {
    assert.equal(await leerArchivoRepo(ctx, 'docs/a.md'), '# Doc A\n');
    const casos = [
      ['.env', 'REPO_NO_PERMITIDO'],
      ['config/clientes.json', 'REPO_NO_PERMITIDO'],
      ['.git/config', 'REPO_NO_PERMITIDO'],
      ['../fuera.md', 'RUTA_INVALIDA'],
      ['C:\\Windows\\win.ini', 'RUTA_ABSOLUTA'],
    ];
    for (const [ruta, codigo] of casos) {
      assert.equal(await codigoDe(leerArchivoRepo(ctx, ruta ?? '')), codigo, ruta);
    }
  });

  test('los prompts y scripts de CI se listan y se leen; el resto de .github sigue invisible', async () => {
    const texto = JSON.stringify(await inventario(ctx));
    assert.match(texto, /\.github\/prompts\/autofix\.md/);
    assert.match(texto, /\.github\/scripts\/validar\.mjs/);
    assert.doesNotMatch(texto, /CODEOWNERS/);
    assert.equal(await leerArchivoRepo(ctx, '.github/prompts/autofix.md'), '# Prompt del agente\n');
    assert.equal(await leerArchivoRepo(ctx, '.github/scripts/validar.mjs'), 'export {};\n');
    assert.equal(await codigoDe(leerArchivoRepo(ctx, '.github/CODEOWNERS')), 'REPO_NO_PERMITIDO');
    assert.equal(await codigoDe(leerArchivoRepo(ctx, '.github/prompts/.env')), 'REPO_NO_PERMITIDO');
  });

  test('el resumen informa la rama y los tags; sin rama de desarrollo no calcula divergencia', async () => {
    const r = await resumenGit(ctx);
    assert.equal(r.rama, 'main');
    assert.equal(r.divergencia, null);
    assert.deepEqual(r.tags, []);
  });

  test('resumenGit reúne las consultas; la divergencia informa -1 si git falla, pero no disfraza otros errores', async () => {
    const conDesarrollo = (consultas: Parameters<typeof consultasGitFalsas>[0]) => ({
      ...ctx,
      config: { ...ctx.config, release: { ...ctx.config.release, rama_desarrollo: 'develop' } },
      consultasGit: consultasGitFalsas(consultas),
    });
    const r = await resumenGit(
      conDesarrollo({
        ramaActual: async () => 'main',
        resolver: async () => 'c'.repeat(40),
        cambiosSinCommit: async () => 2,
        commitsRecientes: async (max) => ['abc1234 2026-09-29 docs: a', 'def5678 2026-09-28 feat: b'].slice(0, max),
        tagsDeVersion: async () => ['v1.0.0'],
        contarCommitsEntre: falloDeGit,
      }),
    );
    assert.deepEqual([r.rama, r.head, r.cambios, r.tags], ['main', 'c'.repeat(40), 2, ['v1.0.0']]);
    assert.deepEqual(r.recientes, ['abc1234 2026-09-29 docs: a', 'def5678 2026-09-28 feat: b']);
    assert.deepEqual(r.divergencia, { principal: 'main', desarrollo: 'develop', principalNoEnDesarrollo: -1, desarrolloNoEnPrincipal: -1 }, 'la rama no está en el clon');
    const conOtroError = conDesarrollo({ contarCommitsEntre: () => Promise.reject(new ErrorMcp('GIT_NO_CONFIGURADO', 'falta git_path')) });
    assert.equal(await codigoDe(divergencia(conOtroError)), 'GIT_NO_CONFIGURADO');
  });

  test('con rama de desarrollo configurada, el resumen informa la divergencia', async () => {
    await esc.escribirConfig({ git_path: rutaGit(), release: { rama_desarrollo: 'develop' } });
    const estado = await validarArranque(['--config', esc.rutaConfig], {});
    assert.ok(estado.ok);
    await escribirNota(esc.repo, 'docs/b.md', 'b\n');
    commitear(esc.repo, 'docs: b');
    const d = (await resumenGit(estado.ctx)).divergencia ?? assert.fail('falta la divergencia');
    assert.deepEqual([d.principal, d.desarrollo, d.principalNoEnDesarrollo, d.desarrolloNoEnPrincipal], ['main', 'develop', 1, 0]);
  });

  test('las categorías de config.json reemplazan a las de por defecto', async () => {
    await escribirNota(esc.repo, 'api/pedidos.ts', 'export {};\n');
    await esc.escribirConfig({
      git_path: rutaGit(),
      repo: { categorias: [{ clave: 'api', descripcion: 'API', carpetas: ['api'], extensiones: ['.ts'] }] },
    });
    const estado = await validarArranque(['--config', esc.rutaConfig], {});
    assert.ok(estado.ok);
    const texto = JSON.stringify(await inventario(estado.ctx));
    assert.match(texto, /api\/pedidos\.ts/);
    assert.doesNotMatch(texto, /docs\/a\.md/);
    assert.equal(await leerArchivoRepo(estado.ctx, 'api/pedidos.ts'), 'export {};\n');
    assert.equal(await codigoDe(leerArchivoRepo(estado.ctx, 'docs/a.md')), 'REPO_NO_PERMITIDO');
  });

  test('una categoría con leer_carpetas false solo muestra nombres', async () => {
    await escribirNota(esc.repo, 'src/secreto-de-negocio.ts', 'export const TESTIGO = 1;\n');
    await esc.escribirConfig({
      git_path: rutaGit(),
      repo: { categorias: [{ clave: 'codigo', descripcion: 'Código', carpetas: ['src'], extensiones: ['.ts'], leer_carpetas: false }] },
    });
    const estado = await validarArranque(['--config', esc.rutaConfig], {});
    assert.ok(estado.ok);
    assert.match(JSON.stringify(await inventario(estado.ctx)), /src\/secreto-de-negocio\.ts/);
    assert.equal(await codigoDe(leerArchivoRepo(estado.ctx, 'src/secreto-de-negocio.ts')), 'REPO_NO_PERMITIDO');
  });

  test('repo.excluir oculta rutas aunque calcen con una categoría', async () => {
    await escribirNota(esc.repo, 'docs/legal/contrato.md', '# TESTIGO-LEGAL\n');
    await escribirNota(esc.repo, 'docs/clientes/acme/notas.md', '# TESTIGO-CLIENTE\n');
    await esc.escribirConfig({ git_path: rutaGit(), repo: { excluir: ['docs/legal/**', '**/clientes/**'] } });
    const estado = await validarArranque(['--config', esc.rutaConfig], {});
    assert.ok(estado.ok);
    const texto = JSON.stringify(await inventario(estado.ctx));
    assert.match(texto, /docs\/a\.md/);
    assert.doesNotMatch(texto, /contrato|acme/);
    assert.equal(await codigoDe(leerArchivoRepo(estado.ctx, 'docs/legal/contrato.md')), 'REPO_NO_PERMITIDO');
    assert.equal(await codigoDe(leerArchivoRepo(estado.ctx, 'docs/clientes/acme/notas.md')), 'REPO_NO_PERMITIDO');
  });

  test('las exclusiones fijas no se pueden desactivar', async () => {
    await escribirNota(esc.repo, 'docs/llave.pem', 'TESTIGO-PEM\n');
    await esc.escribirConfig({ git_path: rutaGit(), repo: { categorias: [{ clave: 'todo', descripcion: 'Todo', carpetas: ['docs'], extensiones: ['.md', '.pem'] }] } });
    const estado = await validarArranque(['--config', esc.rutaConfig], {});
    assert.ok(estado.ok);
    assert.doesNotMatch(JSON.stringify(await inventario(estado.ctx)), /llave\.pem/);
    assert.equal(await codigoDe(leerArchivoRepo(estado.ctx, 'docs/llave.pem')), 'REPO_NO_PERMITIDO');
  });
});

describe('patrones de exclusión', () => {
  test('**, * y ?', () => {
    const casos: [string, string, boolean][] = [
      ['legal/**', 'legal', true],
      ['legal/**', 'legal/a/b.md', true],
      ['legal/**', 'otro/legal/a.md', false],
      ['**/.secretos/**', 'a/b/.secretos/x.json', true],
      ['**/.secretos/**', '.secretos', true],
      ['clientes/*.json', 'clientes/acme.json', true],
      ['clientes/*.json', 'clientes/acme/x.json', false],
      ['docs/v?.md', 'docs/v1.md', true],
      ['docs/v?.md', 'docs/v10.md', false],
      ['a.b/**', 'aXb/c', false], // el punto es literal
      ['Clientes.JSON', 'clientes.json', true], // sin distinguir mayúsculas
    ];
    for (const [patron, ruta, esperado] of casos) assert.equal(patronARegex(patron).test(ruta), esperado, `${patron} ~ ${ruta}`);
  });
});
