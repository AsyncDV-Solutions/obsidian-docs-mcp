import assert from 'node:assert/strict';
import { link, mkdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { crearGuardia, validarRelativa } from '../src/guardia.ts';
import type { Guardia } from '../src/guardia.ts';
import { codigoDe, crearEscenario } from './helpers.ts';
import type { Escenario } from './helpers.ts';

const LIMITES = { nota_max_kb: 1, notas_max: 100 }; // 1 KB: el tope se prueba fácil

function codigoDeSync(fn: () => unknown): string {
  try {
    fn();
    return 'OK';
  } catch (error) {
    return (error as { codigo?: string }).codigo ?? 'OTRO';
  }
}

describe('validarRelativa', () => {
  const casos: [string, string][] = [
    ['Tareas/DEM-T-0001-x.md', 'OK'],
    ['Tareas\\x.md', 'OK'],
    ['../fuera.md', 'RUTA_SALE'],
    ['Tareas/../../fuera.md', 'RUTA_SALE'],
    ['a/./b.md', 'RUTA_SALE'],
    ['C:\\Windows\\x.md', 'RUTA_ABSOLUTA'],
    ['C:x.md', 'RUTA_ABSOLUTA'],
    ['/x.md', 'RUTA_ABSOLUTA'],
    ['\\\\servidor\\c\\x.md', 'RUTA_ABSOLUTA'],
    ['a\u0000b.md', 'RUTA_INVALIDA'],
    ['nota.md:secreto', 'RUTA_INVALIDA'],
    ['a//b.md', 'RUTA_INVALIDA'],
    ['nota.md.', 'RUTA_INVALIDA'],
    ['.oculta.md', 'RUTA_OCULTA'],
    ['.obsidian/app.md', 'RUTA_OCULTA'],
    ['NUL.md', 'RUTA_RESERVADA'],
    ['x.txt', 'RUTA_NO_MD'],
  ];
  for (const [ruta, esperado] of casos) {
    test(`${JSON.stringify(ruta)} → ${esperado}`, () => {
      assert.equal(codigoDeSync(() => validarRelativa(ruta)), esperado);
    });
  }
});

describe('crearGuardia', () => {
  let esc: Escenario;
  let g: Guardia;
  let afuera: string;

  beforeEach(async () => {
    esc = await crearEscenario();
    g = crearGuardia(esc.proyecto, LIMITES);
    afuera = path.join(esc.base, 'afuera');
    await mkdir(afuera, { recursive: true });
    await writeFile(path.join(afuera, 'secreto.md'), 'TESTIGO-AFUERA', 'utf8');
    await writeFile(path.join(esc.proyecto, 'nota.md'), '---\nproject_id: demo\n---\nhola\n', 'utf8');
  });
  afterEach(async () => {
    await esc.limpiar();
  });

  test('lee una nota normal y entrega su versión', async () => {
    const leida = await g.leer('nota.md');
    assert.equal(leida.ruta, 'nota.md');
    assert.match(leida.version, /^[0-9a-f]{16}$/);
  });

  test('no sigue una junction hacia afuera', async () => {
    await symlink(afuera, path.join(esc.proyecto, 'Enlace'), 'junction');
    assert.equal(await codigoDe(g.leer('Enlace/secreto.md')), 'RUTA_ENLACE');
    const { rutas } = await g.listar();
    assert.ok(!rutas.some((r) => r.startsWith('Enlace')), 'listar entró en la junction');
  });

  test('rechaza un archivo con dos nombres (enlace duro)', async () => {
    await link(path.join(esc.proyecto, 'nota.md'), path.join(esc.proyecto, 'copia.md'));
    assert.equal(await codigoDe(g.leer('nota.md')), 'RUTA_ENLACE_DURO');
  });

  test('rechaza un symlink de archivo (si Windows permite crearlo)', async (t) => {
    try {
      await symlink(path.join(afuera, 'secreto.md'), path.join(esc.proyecto, 's.md'), 'file');
    } catch {
      t.skip('No ejecutada: este Windows no permite crear symlinks sin privilegios');
      return;
    }
    assert.equal(await codigoDe(g.leer('s.md')), 'RUTA_ENLACE');
  });

  test('respeta el tamaño máximo', async () => {
    await writeFile(path.join(esc.proyecto, 'grande.md'), 'x'.repeat(2048), 'utf8');
    assert.equal(await codigoDe(g.leer('grande.md')), 'NOTA_GRANDE');
  });

  test('listar ignora ocultos y lo que no es .md', async () => {
    await mkdir(path.join(esc.proyecto, '.oculta'), { recursive: true });
    await writeFile(path.join(esc.proyecto, '.oculta', 'x.md'), 'x', 'utf8');
    await writeFile(path.join(esc.proyecto, 'imagen.png'), 'x', 'utf8');
    const { rutas } = await g.listar();
    assert.deepEqual(rutas.sort(), ['_proyecto.md', 'nota.md']);
  });

  test('rutaParaEscribir exige que la carpeta exista', async () => {
    assert.equal(await codigoDe(g.rutaParaEscribir('Tareas/nueva.md')), 'CARPETA_NO_EXISTE');
    await mkdir(path.join(esc.proyecto, 'Tareas'));
    assert.equal(await codigoDe(g.rutaParaEscribir('Tareas/nueva.md')), 'OK');
  });

  test('rutaParaEscribir rechaza una carpeta que es junction', async () => {
    await symlink(afuera, path.join(esc.proyecto, 'Enlace'), 'junction');
    assert.equal(await codigoDe(g.rutaParaEscribir('Enlace/nueva.md')), 'RUTA_ENLACE');
  });
});
