import assert from 'node:assert/strict';
import { access, mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { aplicarCambio } from '../src/aplicar.ts';
import { validarArranque } from '../src/arranque.ts';
import type { Contexto } from '../src/arranque.ts';
import type { Preparado } from '../src/cambios.ts';
import { ErrorMcp } from '../src/errores.ts';
import { escritorReal } from '../src/escritura.ts';
import type { Escritor } from '../src/escritura.ts';
import { crearSesion } from '../src/sesion.ts';
import { prepararTareaNueva } from '../src/tareas.ts';
import { codigoDe, crearEscenario, escribirNota, notaContadores } from './helpers.ts';
import type { Escenario } from './helpers.ts';

const TAREA = { titulo: 'Encender el correo', descripcion: 'Pasar a la key por site.', criterios: ['Key en Vault'], prioridad: 'P1', estado_inicial: 'Por hacer' as const, pedido_por: 'Ana' };
const RUTA_TAREA = 'Tareas/DEM-T-0001-encender-el-correo.md';

// Aplicar escribe solo por el escritor de la sesión: con uno de mentira se prueban los fallos a mitad de camino,
// que con el disco de verdad no se pueden provocar.
describe('aplicar, con el escritor de la sesión', () => {
  let esc: Escenario;
  let ctx: Contexto;
  const enProyecto = (relativa: string): string => path.join(esc.proyecto, ...relativa.split('/'));
  const existe = (relativa: string): Promise<boolean> => access(enProyecto(relativa)).then(() => true, () => false);

  // Una tarea nueva son dos operaciones, en este orden: reemplazar los contadores y crear la nota.
  async function preparar(escritor: Escritor): Promise<{ sesion: ReturnType<typeof crearSesion>; p: Preparado }> {
    const sesion = crearSesion(ctx, { escritor });
    const p = await prepararTareaNueva(sesion, TAREA);
    assert.ok('confirmacion' in p, 'una tarea nueva no puede salir repetida');
    return { sesion, p };
  }

  beforeEach(async () => {
    esc = await crearEscenario();
    await escribirNota(esc.proyecto, '_contadores.md', notaContadores());
    await mkdir(path.join(esc.proyecto, 'Tareas'));
    const estado = await validarArranque(['--config', esc.rutaConfig], {});
    assert.ok(estado.ok, 'el escenario debería arrancar');
    ctx = estado.ctx;
  });
  afterEach(async () => {
    await esc.limpiar();
  });

  test('todo lo que se escribe pasa por el escritor, con la versión esperada', async () => {
    const llamadas: string[] = [];
    const registrador: Escritor = {
      async crearExclusivo(absoluta, contenido) {
        llamadas.push(`crear ${path.relative(esc.proyecto, absoluta).replaceAll('\\', '/')}`);
        await escritorReal.crearExclusivo(absoluta, contenido);
      },
      async reemplazarAtomico(absoluta, contenido, versionEsperada) {
        llamadas.push(`reemplazar ${path.relative(esc.proyecto, absoluta).replaceAll('\\', '/')} (${versionEsperada.length} caracteres de versión)`);
        await escritorReal.reemplazarAtomico(absoluta, contenido, versionEsperada);
      },
    };
    const { sesion, p } = await preparar(registrador);
    assert.deepEqual(await aplicarCambio(sesion, p.confirmacion), ['reemplazar _contadores.md', `crear ${RUTA_TAREA}`]);
    assert.deepEqual(llamadas, ['reemplazar _contadores.md (16 caracteres de versión)', `crear ${RUTA_TAREA}`]);
    assert.match(await readFile(enProyecto('_contadores.md'), 'utf8'), /ultimo_T: 1/);
    assert.ok(await existe(RUTA_TAREA));
  });

  test('si falla la segunda operación responde PARCIAL, dice qué quedó hecho y no filtra el error del disco', async () => {
    const roto: Escritor = {
      ...escritorReal,
      async crearExclusivo() {
        throw new Error(`EIO: fallo de disco en ${esc.base}`);
      },
    };
    const { sesion, p } = await preparar(roto);
    await assert.rejects(aplicarCambio(sesion, p.confirmacion), (error: unknown) => {
      assert.ok(error instanceof ErrorMcp);
      assert.equal(error.codigo, 'PARCIAL');
      assert.equal(error.message, `Se aplicaron 1 de 2 operaciones (reemplazar _contadores.md); falló ${RUTA_TAREA}: error de escritura`);
      assert.doesNotMatch(error.message, /EIO|fallo de disco/, 'el detalle del sistema no sale');
      return true;
    });
    assert.match(await readFile(enProyecto('_contadores.md'), 'utf8'), /ultimo_T: 1/, 'la primera operación sí se hizo');
    assert.equal(await existe(RUTA_TAREA), false);
  });

  test('un fallo con código propio en la segunda operación se cuenta en el mensaje de PARCIAL', async () => {
    const roto: Escritor = {
      ...escritorReal,
      async crearExclusivo() {
        throw new ErrorMcp('ESCRITURA', 'No pude escribir la nota.');
      },
    };
    const { sesion, p } = await preparar(roto);
    await assert.rejects(aplicarCambio(sesion, p.confirmacion), { codigo: 'PARCIAL', message: /falló Tareas\/DEM-T-0001-encender-el-correo\.md: No pude escribir la nota\.$/ });
  });

  test('si falla la primera operación no queda nada hecho y el error sale tal cual', async () => {
    const roto: Escritor = {
      ...escritorReal,
      async reemplazarAtomico() {
        throw new ErrorMcp('ESCRITURA', 'No pude reemplazar la nota (¿está abierta o bloqueada?). No se cambió nada.');
      },
    };
    const { sesion, p } = await preparar(roto);
    assert.equal(await codigoDe(aplicarCambio(sesion, p.confirmacion)), 'ESCRITURA');
    assert.match(await readFile(enProyecto('_contadores.md'), 'utf8'), /ultimo_T: 0/);
    assert.equal(await existe(RUTA_TAREA), false);
  });

  test('aunque aplicar falle, el código ya no sirve y el bloqueo queda libre', async () => {
    const roto: Escritor = {
      ...escritorReal,
      async crearExclusivo() {
        throw new Error('EIO');
      },
    };
    const { sesion, p } = await preparar(roto);
    assert.equal(await codigoDe(aplicarCambio(sesion, p.confirmacion)), 'PARCIAL');
    assert.equal(await codigoDe(aplicarCambio(sesion, p.confirmacion)), 'CONFIRMACION_INVALIDA');
    assert.ok(!(await readdir(ctx.dirEstado)).includes('escritura.lock'), 'el archivo de bloqueo se borra aunque falle');
  });
});
