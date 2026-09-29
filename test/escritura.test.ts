import assert from 'node:assert/strict';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { escribirBloque, leerBloque } from '../src/bloques.ts';
import { conBloqueo, crearExclusivo, reemplazarAtomico } from '../src/escritura.ts';
import { versionDe } from '../src/guardia.ts';
import { codigoDe, crearEscenario } from './helpers.ts';
import type { Escenario } from './helpers.ts';

describe('escritura segura', () => {
  let esc: Escenario;
  let ruta: string;
  beforeEach(async () => {
    esc = await crearEscenario();
    ruta = path.join(esc.proyecto, 'a.md');
  });
  afterEach(async () => {
    await esc.limpiar();
  });

  test('conBloqueo deja pasar a una sola sesión y libera el turno aunque el trabajo falle', async () => {
    const bloqueo = path.join(esc.proyecto, 'escritura.lock');
    await conBloqueo(esc.proyecto, async () => {
      assert.equal(await codigoDe(conBloqueo(esc.proyecto, async () => 'otra sesión')), 'BLOQUEO_OCUPADO');
      assert.match(await readFile(bloqueo, 'utf8'), /^\d+ \d{4}-\d{2}-\d{2}T/, 'el archivo dice quién y cuándo');
    });
    await assert.rejects(
      conBloqueo(esc.proyecto, async () => {
        throw new Error('falla');
      }),
      { message: 'falla' },
    );
    assert.deepEqual((await readdir(esc.proyecto)).filter((n) => n === 'escritura.lock'), [], 'no queda el archivo');
    assert.equal(await conBloqueo(esc.proyecto, async () => 'listo'), 'listo', 'tras un fallo el turno queda libre');
  });

  test('crear nunca sobrescribe', async () => {
    await crearExclusivo(ruta, 'uno');
    assert.equal(await codigoDe(crearExclusivo(ruta, 'dos')), 'YA_EXISTE');
    assert.equal(await readFile(ruta, 'utf8'), 'uno');
  });

  test('reemplazar exige la versión esperada y no deja temporales', async () => {
    await writeFile(ruta, 'original', 'utf8');
    assert.equal(await codigoDe(reemplazarAtomico(ruta, 'nuevo', '0000000000000000')), 'CONFLICTO');
    assert.equal(await readFile(ruta, 'utf8'), 'original');
    await reemplazarAtomico(ruta, 'nuevo', versionDe('original'));
    assert.equal(await readFile(ruta, 'utf8'), 'nuevo');
    assert.deepEqual((await readdir(esc.proyecto)).filter((n) => n.endsWith('.tmp')), []);
  });
});

describe('bloques gestionados', () => {
  const nota = ['## Notas', 'mío', '## Historial', '%% asyncdv:inicio historial %%', '%% asyncdv:fin %%', 'después'].join('\n');

  test('escribir y releer el bloque sin tocar lo de afuera', () => {
    const nueva = escribirBloque(nota, 'historial', '- línea 1', '\n');
    assert.equal(leerBloque(nueva, 'historial')?.contenido, '- línea 1');
    assert.equal(leerBloque(nueva, 'historial')?.editadoAMano, false);
    assert.ok(nueva.startsWith('## Notas\nmío\n## Historial\n'));
    assert.ok(nueva.endsWith('%% asyncdv:fin %%\ndespués'));
  });

  test('la huella detecta una edición a mano', () => {
    const editada = escribirBloque(nota, 'historial', '- línea 1', '\n').replace('- línea 1', '- línea 1 editada');
    assert.equal(leerBloque(editada, 'historial')?.editadoAMano, true);
  });

  test('un bloque sin marcador de fin está roto: no se lee como vacío ni se reescribe', () => {
    const roto = ['## Notas', 'mío', '%% asyncdv:inicio historial %%', '- línea', 'sin cierre'].join('\n');
    assert.throws(() => leerBloque(roto, 'historial'), { codigo: 'BLOQUE_ROTO' });
    assert.throws(() => escribirBloque(roto, 'historial', '- nueva', '\n'), { codigo: 'BLOQUE_ROTO' });
  });

  test('conserva CRLF', () => {
    const nueva = escribirBloque(nota.replaceAll('\n', '\r\n'), 'historial', '- a', '\r\n');
    assert.ok(!/[^\r]\n/.test(nueva));
  });

  test('normaliza los saltos del contenido al eol pedido', () => {
    const crlf = escribirBloque(nota.replaceAll('\n', '\r\n'), 'historial', '- a\n- b', '\r\n');
    assert.ok(!/[^\r]\n/.test(crlf), 'apareció un salto LF suelto');
    assert.equal(leerBloque(crlf, 'historial')?.contenido, '- a\r\n- b');
    const lf = escribirBloque(nota, 'historial', '- a\r\n- b', '\n');
    assert.ok(!lf.includes('\r'), 'quedó un CR en una nota LF');
    assert.equal(leerBloque(lf, 'historial')?.editadoAMano, false);
  });
});
