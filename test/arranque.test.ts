import assert from 'node:assert/strict';
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { validarArranque } from '../src/arranque.ts';
import type { EstadoArranque } from '../src/arranque.ts';
import { crearEscenario, marcador } from './helpers.ts';
import type { Escenario } from './helpers.ts';

function codigos(estado: EstadoArranque): string[] {
  return estado.ok ? [] : estado.problemas.map((p) => p.codigo);
}

describe('validarArranque', () => {
  let esc: Escenario;
  const arrancar = () => validarArranque(['--config', esc.rutaConfig], {});

  beforeEach(async () => {
    esc = await crearEscenario();
  });
  afterEach(async () => {
    await esc.limpiar();
  });

  test('una configuración válida arranca', async () => {
    const estado = await arrancar();
    assert.deepEqual(codigos(estado), []);
    assert.equal(estado.ok, true);
  });

  test('sin --config ni variables de entorno', async () => {
    assert.deepEqual(codigos(await validarArranque([], {})), ['CONFIG_FALTA']);
  });

  test('con un argumento desconocido', async () => {
    assert.deepEqual(codigos(await validarArranque(['--config', esc.rutaConfig, '--otro'], {})), ['ARGS']);
  });

  test('la ruta de config.json también llega por ASYNCDV_DOCS_CONFIG', async () => {
    assert.equal((await validarArranque([], { ASYNCDV_DOCS_CONFIG: esc.rutaConfig })).ok, true);
  });

  test('sin archivo: toda la configuración desde variables de entorno', async () => {
    const estado = await validarArranque([], {
      ASYNCDV_DOCS_PROJECT_ID: 'demo',
      ASYNCDV_DOCS_PROJECT_NAME: 'Demo App',
      ASYNCDV_DOCS_ID_PREFIX: 'DEM',
      ASYNCDV_DOCS_REPO_PATH: esc.repo,
      ASYNCDV_DOCS_VAULT_PATH: esc.vault,
      ASYNCDV_DOCS_PROJECT_DIR: 'Proyectos/demo',
      ASYNCDV_DOCS_ZONA_HORARIA: 'UTC',
      ASYNCDV_DOCS_STATE_DIR: path.join(esc.base, 'estado'),
      ASYNCDV_DOCS_USUARIO: 'Ana',
      ASYNCDV_DOCS_VACIA: '', // las desconocidas y las vacías se ignoran
    });
    assert.deepEqual(codigos(estado), []);
    assert.ok(estado.ok);
    assert.equal(estado.ctx.config.project_name, 'Demo App');
    assert.equal(estado.ctx.config.usuario, 'Ana');
    assert.equal(estado.ctx.dirEstado, path.join(esc.base, 'estado')); // se crea si falta
  });

  test('las variables de entorno pisan a config.json', async () => {
    await esc.escribirConfig({ project_dir: 'Proyectos/no-existe' });
    assert.deepEqual(codigos(await arrancar()), ['RUTA_NO_EXISTE']);
    assert.equal((await validarArranque(['--config', esc.rutaConfig], { ASYNCDV_DOCS_PROJECT_DIR: 'Proyectos/demo' })).ok, true);
  });

  test('una variable de entorno inválida se rechaza como el archivo', async () => {
    assert.deepEqual(codigos(await validarArranque(['--config', esc.rutaConfig], { ASYNCDV_DOCS_ID_PREFIX: 'minusculas' })), ['CONFIG_ESQUEMA']);
  });

  test('state_dir dentro del vault se rechaza sin crearla', async () => {
    const dentro = path.join(esc.vault, 'estado-mcp');
    await esc.escribirConfig({ state_dir: dentro });
    assert.deepEqual(codigos(await arrancar()), ['CONFIG_DENTRO']);
    await assert.rejects(readFile(dentro), { code: 'ENOENT' });
  });

  test('las opciones nuevas tienen valores por defecto', async () => {
    const estado = await arrancar();
    assert.ok(estado.ok);
    const cfg = estado.ctx.config;
    assert.equal(cfg.carpetas.tareas, 'Tareas');
    assert.equal(cfg.release.rama_principal, 'main');
    assert.equal(cfg.release.rama_desarrollo, undefined);
    assert.ok(cfg.repo.categorias.some((c) => c.clave === 'codigo'));
    assert.ok(cfg.areas.includes('backend'));
    assert.equal(estado.ctx.dirEstado, esc.dirConfig); // sin state_dir, la carpeta de config.json
  });

  test('áreas, categorías y carpetas se validan', async () => {
    const casos: Record<string, unknown>[] = [
      { areas: ['Frontend'] },
      { areas: ['api', 'api'] },
      { carpetas: { tareas: '../fuera' } },
      { carpetas: { tareas: '.oculta' } },
      { repo: { categorias: [{ clave: 'x', descripcion: 'X', carpetas: ['src'] }] } }, // carpetas sin extensiones
      { repo: { categorias: [{ clave: 'x', descripcion: 'X', archivos: ['../fuera.md'] }] } },
      { repo: { excluir: ['/absoluto/**'] } },
      { release: { rama_desarrollo: '--output=x' } },
    ];
    for (const cambios of casos) {
      await esc.escribirConfig(cambios);
      assert.deepEqual(codigos(await arrancar()), ['CONFIG_ESQUEMA'], JSON.stringify(cambios));
    }
  });

  test('plantillas_dir: una plantilla propia que calza se usa; una que no calza se rechaza', async () => {
    const propias = path.join(esc.base, 'plantillas');
    await mkdir(propias);
    await writeFile(path.join(propias, 'decision.md'), '## Contexto\n{{contexto}}\n## Decisión\n{{decision}}\n## Opciones\n{{alternativas}}\n## Efectos\n{{consecuencias}}\n', 'utf8');
    await esc.escribirConfig({ plantillas_dir: propias });
    const estado = await arrancar();
    assert.ok(estado.ok);
    assert.equal(estado.ctx.plantillas, propias);
    // Otra carpeta: las plantillas quedan en caché por carpeta mientras el proceso vive.
    const rotas = path.join(esc.base, 'plantillas-rotas');
    await mkdir(rotas);
    await writeFile(path.join(rotas, 'tarea.md'), '## Descripción\n{{descripcion}}\n', 'utf8'); // le faltan criterios e historial
    await esc.escribirConfig({ plantillas_dir: rotas });
    assert.deepEqual(codigos(await arrancar()), ['PLANTILLA_INVALIDA']);
  });

  test('plantillas_dir: una guia.md propia que no calza ni con el formato vigente ni con el anterior se rechaza', async () => {
    const propias = path.join(esc.base, 'plantillas-guia');
    await mkdir(propias);
    // Formato anterior a la 2.1.0, pero sin {{problemas}}.
    await writeFile(path.join(propias, 'guia.md'), '## Para qué\n{{proposito}}\n## Uso\n{{pasos}}\n{{afirmaciones}}\n{{pendientes}}\n', 'utf8');
    await esc.escribirConfig({ plantillas_dir: propias });
    assert.deepEqual(codigos(await arrancar()), ['PLANTILLA_INVALIDA']);
  });

  test('plantillas_dir dentro del vault se rechaza', async () => {
    const dentro = path.join(esc.vault, 'Plantillas');
    await mkdir(dentro);
    await esc.escribirConfig({ plantillas_dir: dentro });
    assert.deepEqual(codigos(await arrancar()), ['PLANTILLAS_DENTRO']);
  });

  test('config.json no existe', async () => {
    await rm(esc.rutaConfig);
    assert.deepEqual(codigos(await arrancar()), ['CONFIG_NO_EXISTE']);
  });

  test('config.json no es JSON', async () => {
    await writeFile(esc.rutaConfig, '{ esto no es json', 'utf8');
    assert.deepEqual(codigos(await arrancar()), ['CONFIG_JSON']);
  });

  test('config.json con BOM se acepta', async () => {
    const texto = await readFile(esc.rutaConfig, 'utf8');
    await writeFile(esc.rutaConfig, `\uFEFF${texto}`, 'utf8');
    assert.equal((await arrancar()).ok, true);
  });

  test('una clave desconocida se rechaza', async () => {
    await esc.escribirConfig({ clave_rara: true });
    assert.deepEqual(codigos(await arrancar()), ['CONFIG_ESQUEMA']);
  });

  test('una ruta relativa se rechaza', async () => {
    await esc.escribirConfig({ repo_path: 'repo' });
    assert.deepEqual(codigos(await arrancar()), ['CONFIG_ESQUEMA']);
  });

  test('project_dir con .. se rechaza', async () => {
    await esc.escribirConfig({ project_dir: 'Proyectos/../otro' });
    assert.deepEqual(codigos(await arrancar()), ['CONFIG_ESQUEMA']);
  });

  test('la carpeta del proyecto no existe', async () => {
    await esc.escribirConfig({ project_dir: 'Proyectos/no-existe' });
    assert.deepEqual(codigos(await arrancar()), ['RUTA_NO_EXISTE']);
  });

  test('el repo sin .git', async () => {
    await rm(path.join(esc.repo, '.git'), { recursive: true });
    assert.deepEqual(codigos(await arrancar()), ['REPO_SIN_GIT']);
  });

  test('el vault dentro del repo', async () => {
    const vaultEnRepo = path.join(esc.repo, 'vault');
    await mkdir(path.join(vaultEnRepo, 'Proyectos', 'demo'), { recursive: true });
    await writeFile(path.join(vaultEnRepo, 'Proyectos', 'demo', '_proyecto.md'), marcador(), 'utf8');
    await esc.escribirConfig({ vault_path: vaultEnRepo });
    assert.deepEqual(codigos(await arrancar()), ['SOLAPAMIENTO']);
  });

  test('sin marcador', async () => {
    await rm(path.join(esc.proyecto, '_proyecto.md'));
    assert.deepEqual(codigos(await arrancar()), ['MARCADOR_FALTA']);
  });

  test('un marcador de otro proyecto', async () => {
    await writeFile(path.join(esc.proyecto, '_proyecto.md'), marcador('otro'), 'utf8');
    assert.deepEqual(codigos(await arrancar()), ['MARCADOR_AJENO']);
  });

  test('project_id con otra capitalización también es ajeno', async () => {
    await writeFile(path.join(esc.proyecto, '_proyecto.md'), marcador('Demo'), 'utf8');
    assert.deepEqual(codigos(await arrancar()), ['MARCADOR_AJENO']);
  });

  test('un marcador con BOM y CRLF se acepta', async () => {
    await writeFile(path.join(esc.proyecto, '_proyecto.md'), `\uFEFF${marcador().replaceAll('\n', '\r\n')}`, 'utf8');
    assert.equal((await arrancar()).ok, true);
  });

  test('una junction en la ruta del proyecto se rechaza', async () => {
    const afuera = path.join(esc.base, 'afuera');
    await mkdir(afuera, { recursive: true });
    await writeFile(path.join(afuera, '_proyecto.md'), marcador(), 'utf8');
    await symlink(afuera, path.join(esc.vault, 'Proyectos', 'enlace'), 'junction');
    await esc.escribirConfig({ project_dir: 'Proyectos/enlace' });
    assert.deepEqual(codigos(await arrancar()), ['RUTA_ENLACE']);
  });
});
