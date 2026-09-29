import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { validarArranque } from '../src/arranque.ts';
import type { Contexto } from '../src/arranque.ts';
import { git, inventario, leerArchivoRepo, patronARegex, resumenGit, validarRef } from '../src/repo.ts';
import { commitear, convertirEnRepoGit, crearEscenario, escribirNota, gitDirecto, rutaGit } from './helpers.ts';
import type { Escenario } from './helpers.ts';

async function existe(ruta: string): Promise<boolean> {
  try {
    await access(ruta);
    return true;
  } catch {
    return false;
  }
}

async function codigoDe(promesa: Promise<unknown>): Promise<string> {
  try {
    await promesa;
    return 'OK';
  } catch (error) {
    return (error as { codigo?: string }).codigo ?? 'OTRO';
  }
}

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

  test('las referencias que parecen opciones se rechazan', () => {
    assert.equal(validarRef('main'), 'main');
    assert.throws(() => validarRef('--output=x'), { codigo: 'REF_INVALIDA' });
    assert.throws(() => validarRef('main..develop'), { codigo: 'REF_INVALIDA' });
  });

  test('git no reescribe el índice', async () => {
    const indice = path.join(esc.repo, '.git', 'index');
    const huella = async (): Promise<string> => createHash('sha256').update(await readFile(indice)).digest('hex');
    const antes = await huella();
    const ahora = new Date();
    await utimes(path.join(esc.repo, 'docs', 'a.md'), ahora, ahora); // mismo contenido, otra fecha: git querría refrescar el índice
    await git(ctx, ['status', '--porcelain=v1']);
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
    await git(ctx, ['status', '--porcelain=v1']);
    assert.equal(await existe(testigo), false);
  });

  test('el resumen informa la rama y los tags; sin rama de desarrollo no calcula divergencia', async () => {
    const r = await resumenGit(ctx);
    assert.equal(r.rama, 'main');
    assert.equal(r.divergencia, null);
    assert.deepEqual(r.tags, []);
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
