import assert from 'node:assert/strict';
import { access, mkdir, open, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { aplicarCambio } from '../src/aplicar.ts';
import { validarArranque } from '../src/arranque.ts';
import { cargarConfig } from '../src/config.ts';
import { buscarGit, iniciarProyecto } from '../src/iniciar.ts';
import { prepararTareaNueva } from '../src/tareas.ts';
import { crearSesion } from '../src/sesion.ts';
import { codigoDe, crearEscenario } from './helpers.ts';
import type { Escenario } from './helpers.ts';

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
    assert.match(await readFile(path.join(esc.proyecto, '_contadores.md'), 'utf8'), /type: contadores\nschema: 1\ntitle: Contadores\nultimo_T: 0\nultimo_F: 0\nultimo_I: 0\nultimo_ADR: 0\nultimo_G: 0\n/);
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

  // iniciar crea las notas del sistema con crearExclusivo, como aplicar: fuerza el paso a disco (fsync) y no deja una
  // nota a medias. Se observa el fsync en el prototipo de los archivos abiertos.
  async function archivoAbierto(): Promise<{ sync(): Promise<void> }> {
    const abierto = await open(esc.rutaConfig, 'r');
    try {
      return Object.getPrototypeOf(abierto) as { sync(): Promise<void> };
    } finally {
      await abierto.close();
    }
  }

  test('las notas del sistema se escriben con fsync', async (t) => {
    const sync = t.mock.method(await archivoAbierto(), 'sync');
    const r = await iniciarProyecto(await config());
    assert.equal(r.creadas.filter((c) => c.endsWith('.md')).length, 3);
    assert.equal(sync.mock.callCount(), 3, 'un fsync por cada nota del sistema');
  });

  test('si el disco falla al escribir una nota del sistema, no queda a medias', async (t) => {
    t.mock.method(await archivoAbierto(), 'sync', async () => {
      throw new Error('EIO');
    });
    await assert.rejects(iniciarProyecto(await config()), /EIO/);
    await assert.rejects(access(path.join(esc.proyecto, '_proyecto.md')), 'la nota que falló se borra');
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
    const sesion = crearSesion(estado.ctx);
    const datos = { titulo: 'Probar carpetas', descripcion: 'x', criterios: ['y'], prioridad: 'P2', estado_inicial: 'Por hacer' as const };
    const p = await prepararTareaNueva(sesion, datos);
    assert.ok('confirmacion' in p, 'una tarea nueva no puede salir repetida');
    await aplicarCambio(sesion, p.confirmacion);
    const texto = await readFile(path.join(sesion.proyecto, 'Trabajo', 'Pendientes', 'DEM-T-0001-probar-carpetas.md'), 'utf8');
    assert.match(texto, /pidió: Ana/);
  });
});
