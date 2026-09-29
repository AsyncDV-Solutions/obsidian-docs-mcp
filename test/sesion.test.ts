import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { validarArranque } from '../src/arranque.ts';
import type { Contexto } from '../src/arranque.ts';
import type { Cambio } from '../src/cambios.ts';
import { crearSesion } from '../src/sesion.ts';
import { codigoDe, crearEscenario, escribirNota, notaTarea } from './helpers.ts';
import type { Escenario } from './helpers.ts';

const cambio: Cambio = { descripcion: 'a', operaciones: [] };

describe('sesión', () => {
  let esc: Escenario;

  async function arrancar(config: Record<string, unknown> = {}): Promise<Contexto> {
    await esc.escribirConfig(config);
    const estado = await validarArranque(['--config', esc.rutaConfig], {});
    assert.ok(estado.ok, 'el escenario debería arrancar');
    return estado.ctx;
  }

  beforeEach(async () => {
    esc = await crearEscenario();
  });
  afterEach(async () => {
    await esc.limpiar();
  });

  test('el arranque entrega el guardia del proyecto, que la sesión usa', async () => {
    const ctx = await arrancar();
    assert.equal((await ctx.guardia.leer('_proyecto.md')).ruta, '_proyecto.md');
    const sesion = crearSesion(ctx);
    assert.equal(sesion.guardia, ctx.guardia);
    assert.equal(sesion.config, ctx.config);
    assert.equal(sesion.consultasGit, ctx.consultasGit);
  });

  test('indice() lee el vault cada vez que se le pide, sin recordar lo anterior', async () => {
    const sesion = crearSesion(await arrancar());
    assert.deepEqual((await sesion.indice()).notas.map((n) => n.ruta), ['_proyecto.md'], 'al principio solo está el marcador del proyecto');
    await escribirNota(esc.proyecto, 'Tareas/DEM-T-0001-a.md', notaTarea({ id: 'DEM-T-0001', titulo: 'A' }));
    assert.deepEqual((await sesion.indice()).notas.map((n) => n.ruta).sort(), ['Tareas/DEM-T-0001-a.md', '_proyecto.md']);
  });

  test('cada sesión tiene su almacén de códigos y su tope: no se comparten', async () => {
    const ctx = await arrancar({ limites: { escrituras_por_minuto: 1 } });
    const a = crearSesion(ctx);
    const b = crearSesion(ctx);
    const { confirmacion } = a.almacen.guardar(cambio, 5);
    assert.throws(() => b.almacen.retirar(confirmacion), /no existe, ya se usó o venció/);
    a.tope.contar();
    assert.throws(() => a.tope.exigir(), /1 escrituras por minuto/);
    b.tope.exigir();
  });

  test('el tope y la vida de los códigos salen de la configuración y del reloj de la sesión', async () => {
    let ahora = 1_700_000_000_000;
    const sesion = crearSesion(await arrancar({ limites: { escrituras_por_minuto: 2 } }), { reloj: () => ahora });
    const { expira } = sesion.almacen.guardar(cambio, sesion.config.limites.confirmacion_minutos);
    assert.equal(expira.getTime(), ahora + 5 * 60_000, 'confirmacion_minutos vale 5 por defecto');
    sesion.tope.contar();
    sesion.tope.contar();
    assert.throws(() => sesion.tope.exigir(), /2 escrituras por minuto/);
    ahora += 60_000;
    sesion.tope.exigir();
  });

  test('sin reloj ni escritor propios usa el reloj de verdad y escribe de verdad', async () => {
    const antes = Date.now();
    const sesion = crearSesion(await arrancar());
    const { expira } = sesion.almacen.guardar(cambio, 5);
    assert.ok(expira.getTime() >= antes + 5 * 60_000 && expira.getTime() <= Date.now() + 5 * 60_000);
    await mkdir(path.join(esc.proyecto, 'Tareas'));
    const ruta = path.join(esc.proyecto, 'Tareas', 'nueva.md');
    await sesion.escritor.crearExclusivo(ruta, 'hola\n');
    assert.equal(await readFile(ruta, 'utf8'), 'hola\n');
    assert.equal(await codigoDe(sesion.escritor.crearExclusivo(ruta, 'otra\n')), 'YA_EXISTE', 'crear nunca sobrescribe');
  });
});
