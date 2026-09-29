import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { aplicarCambio } from '../src/aplicar.ts';
import { validarArranque } from '../src/arranque.ts';
import { cargarConfig } from '../src/config.ts';
import { crearGuardia } from '../src/guardia.ts';
import { quienPide } from '../src/herramientas/comun.ts';
import { buscarGit, iniciarProyecto } from '../src/iniciar.ts';
import { indexar } from '../src/notas.ts';
import { prepararTareaNueva } from '../src/tareas.ts';
import { crearEscenario } from './helpers.ts';
import type { Escenario } from './helpers.ts';

async function codigoDe(promesa: Promise<unknown>): Promise<string> {
  try {
    await promesa;
    return 'OK';
  } catch (error) {
    return (error as { codigo?: string }).codigo ?? 'OTRO';
  }
}

describe('iniciar: prepara la carpeta del proyecto en el vault', () => {
  let esc: Escenario;

  beforeEach(async () => {
    esc = await crearEscenario();
    await rm(path.join(esc.vault, 'Proyectos'), { recursive: true }); // el vault existe, el proyecto todavía no
    await mkdir(path.join(esc.vault, '.obsidian'));
  });
  afterEach(async () => {
    await esc.limpiar();
  });

  const config = async (cambios: Record<string, unknown> = {}) => {
    await esc.escribirConfig({ project_name: 'Demo App', ...cambios });
    return (await cargarConfig(esc.rutaConfig, {})).config;
  };

  test('crea carpetas y notas del sistema, y después el servidor arranca', async () => {
    const r = await iniciarProyecto(await config({ carpetas: { tareas: 'Trabajo/Tareas' } }));
    assert.deepEqual(r.avisos, []);
    assert.ok(r.creadas.includes('_proyecto.md') && r.creadas.includes('_contadores.md') && r.creadas.includes('Tablero.md'));
    const carpetas = await readdir(esc.proyecto);
    for (const c of ['Trabajo', 'Funcionalidades', 'Decisiones', 'Incidencias', 'Releases', 'Guias']) assert.ok(carpetas.includes(c), c);
    assert.deepEqual(await readdir(path.join(esc.proyecto, 'Trabajo')), ['Tareas']);
    assert.match(await readFile(path.join(esc.proyecto, '_proyecto.md'), 'utf8'), /project_id: demo\ntype: proyecto\nid_prefix: DEM\nschema: 1\ntitle: Demo App/);
    assert.equal((await validarArranque(['--config', esc.rutaConfig], {})).ok, true);
  });

  test('es idempotente: lo que existe no se toca', async () => {
    const cfg = await config();
    await iniciarProyecto(cfg);
    const tablero = path.join(esc.proyecto, 'Tablero.md');
    await writeFile(tablero, 'TESTIGO: editado a mano\n', 'utf8');
    const r = await iniciarProyecto(cfg);
    assert.deepEqual(r.creadas, []);
    assert.ok(r.existentes.includes('Tablero.md'));
    assert.equal(await readFile(tablero, 'utf8'), 'TESTIGO: editado a mano\n');
  });

  test('avisa si el vault no parece un vault de Obsidian', async () => {
    await rm(path.join(esc.vault, '.obsidian'), { recursive: true });
    assert.equal((await iniciarProyecto(await config())).avisos.length, 1);
  });

  test('no crea nada a través de un enlace', async () => {
    const afuera = path.join(esc.base, 'afuera');
    await mkdir(afuera);
    await symlink(afuera, path.join(esc.vault, 'Proyectos'), 'junction');
    assert.equal(await codigoDe(iniciarProyecto(await config())), 'RUTA_ENLACE');
    assert.deepEqual(await readdir(afuera), []);
  });

  test('no crea el vault', async () => {
    assert.equal(await codigoDe(iniciarProyecto(await config({ vault_path: path.join(esc.base, 'no-existe') }))), 'RUTA_NO_EXISTE');
  });

  test('buscarGit encuentra git en el PATH sin lanzar procesos', async () => {
    const git = await buscarGit();
    if (git !== null) assert.ok(path.isAbsolute(git));
    assert.equal(await buscarGit({ PATH: '' }), null);
  });
});

describe('carpetas y usuario configurables', () => {
  let esc: Escenario;

  beforeEach(async () => {
    esc = await crearEscenario();
  });
  afterEach(async () => {
    await esc.limpiar();
  });

  test('las tareas se crean en la carpeta configurada', async () => {
    await esc.escribirConfig({ carpetas: { tareas: 'Trabajo/Pendientes' }, usuario: 'Ana' });
    await iniciarProyecto((await cargarConfig(esc.rutaConfig, {})).config);
    const estado = await validarArranque(['--config', esc.rutaConfig], {});
    assert.ok(estado.ok);
    const { ctx } = estado;
    const g = crearGuardia(ctx.proyecto, ctx.config.limites);
    const datos = { titulo: 'Probar carpetas', descripcion: 'x', criterios: ['y'], prioridad: 'P2', estado_inicial: 'Por hacer' as const };
    const p = await prepararTareaNueva(ctx, g, await indexar(g, ctx.config), { ...datos, pedido_por: quienPide(ctx, undefined) });
    await aplicarCambio(ctx, g, p.confirmacion);
    const texto = await readFile(path.join(ctx.proyecto, 'Trabajo', 'Pendientes', 'DEM-T-0001-probar-carpetas.md'), 'utf8');
    assert.match(texto, /pidió: Ana/);
  });

  test('pedido_por: el explícito gana; sin él, el usuario configurado; sin ninguno, error', async () => {
    await esc.escribirConfig({ usuario: 'Ana' });
    const conUsuario = await validarArranque(['--config', esc.rutaConfig], {});
    assert.ok(conUsuario.ok);
    assert.equal(quienPide(conUsuario.ctx, 'Luis'), 'Luis');
    assert.equal(quienPide(conUsuario.ctx, undefined), 'Ana');
    await esc.escribirConfig();
    const sinUsuario = await validarArranque(['--config', esc.rutaConfig], {});
    assert.ok(sinUsuario.ok);
    assert.throws(() => quienPide(sinUsuario.ctx, undefined), { codigo: 'FALTA_PEDIDO_POR' });
  });
});
