import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { validarArranque } from '../src/arranque.ts';
import type { Contexto } from '../src/arranque.ts';
import type { Cambio } from '../src/cambios.ts';
import { crearSesion } from '../src/sesion.ts';
import { codigoDe, crearEscenario, escribirNota, notaTarea, relojFalso } from './helpers.ts';
import type { Escenario } from './helpers.ts';

const cambio: Cambio = { descripcion: 'a', operaciones: [] };
const MINUTO = 60_000;

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
    const primera = crearSesion(ctx);
    const segunda = crearSesion(ctx);
    const { confirmacion } = primera.almacen.guardar(cambio);
    assert.throws(() => segunda.almacen.retirar(confirmacion), { codigo: 'CONFIRMACION_INVALIDA' });
    primera.tope.contar();
    assert.throws(() => primera.tope.exigir(), { codigo: 'LIMITE' });
    segunda.tope.exigir();
  });

  test('los códigos duran lo que dice confirmacion_minutos y siguen el reloj de la sesión', async () => {
    const reloj = relojFalso();
    const sesion = crearSesion(await arrancar({ limites: { confirmacion_minutos: 2 } }), { reloj });
    const { confirmacion, minutos } = sesion.almacen.guardar(cambio);
    assert.equal(minutos, 2);
    reloj.avanzar(2 * MINUTO - 1);
    assert.equal(sesion.almacen.retirar(confirmacion), cambio, 'a los 2 minutos menos un milisegundo todavía sirve');
    const otro = sesion.almacen.guardar(cambio).confirmacion;
    reloj.avanzar(2 * MINUTO);
    assert.throws(() => sesion.almacen.retirar(otro), { codigo: 'CONFIRMACION_INVALIDA' }, 'con el valor por defecto, 5, todavía serviría');
  });

  test('el tope sale de escrituras_por_minuto y sigue el reloj de la sesión', async () => {
    const reloj = relojFalso();
    const sesion = crearSesion(await arrancar({ limites: { escrituras_por_minuto: 2 } }), { reloj });
    sesion.tope.contar();
    sesion.tope.contar();
    assert.throws(() => sesion.tope.exigir(), /2 escrituras por minuto/);
    reloj.avanzar(MINUTO);
    sesion.tope.exigir();
  });

  test('sin escritor propio escribe de verdad en el vault', async () => {
    const sesion = crearSesion(await arrancar());
    await mkdir(path.join(esc.proyecto, 'Tareas'));
    const ruta = path.join(esc.proyecto, 'Tareas', 'nueva.md');
    await sesion.escritor.crearExclusivo(ruta, 'hola\n');
    assert.equal(await readFile(ruta, 'utf8'), 'hola\n');
    assert.equal(await codigoDe(sesion.escritor.crearExclusivo(ruta, 'otra\n')), 'YA_EXISTE', 'crear nunca sobrescribe');
  });
});
