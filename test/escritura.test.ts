import assert from 'node:assert/strict';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { escribirBloque, leerBloque } from '../src/bloques.ts';
import { consumirCupo, diffLineas, guardarCambio, tomarCambio } from '../src/confirmaciones.ts';
import { crearExclusivo, reemplazarAtomico } from '../src/escritura.ts';
import { versionDe } from '../src/guardia.ts';
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

describe('confirmaciones, tope y diff', () => {
  test('un código vencido se rechaza', () => {
    const { confirmacion } = guardarCambio({ descripcion: 'x', operaciones: [] }, 0);
    assert.throws(() => tomarCambio(confirmacion), { codigo: 'CONFIRMACION_INVALIDA' });
  });

  test('el tope de escrituras corta', () => {
    consumirCupo(2);
    consumirCupo(2);
    assert.throws(() => consumirCupo(2), { codigo: 'LIMITE' });
  });

  test('el diff muestra lo que cambia', () => {
    assert.equal(diffLineas('a\nb\nc', 'a\nB\nc'), '  a\n- b\n+ B\n  c');
  });
});
