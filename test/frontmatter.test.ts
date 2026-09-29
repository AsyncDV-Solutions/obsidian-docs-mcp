import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { separarNota, unirNota } from '../src/frontmatter.ts';

const MAX = 16 * 1024;

describe('frontmatter', () => {
  test('separa y vuelve a unir sin cambiar BOM, saltos de línea ni cuerpo', () => {
    const original = `﻿${['---', 'id: DEM-T-0001', 'title: Uno', '---', '## Notas', 'mío', ''].join('\r\n')}`;
    const nota = separarNota(original, MAX);
    assert.equal(nota.bom, true);
    assert.equal(nota.eol, '\r\n');
    assert.deepEqual(nota.datos, { id: 'DEM-T-0001', title: 'Uno' });
    assert.equal(nota.cuerpo, '## Notas\r\nmío\r\n');
    assert.equal(unirNota(nota), original);
  });

  test('una nota sin bloque de propiedades se rechaza', () => {
    assert.throws(() => separarNota('## Solo cuerpo\n', MAX), { codigo: 'SIN_PROPIEDADES' });
    assert.throws(() => separarNota('---\nid: x\n', MAX), { codigo: 'SIN_PROPIEDADES' }, 'sin el delimitador de cierre');
  });

  test('propiedades que no son pares clave: valor se rechazan', () => {
    assert.throws(() => separarNota('---\n- uno\n- dos\n---\n', MAX), { codigo: 'YAML_NO_MAPA' });
  });

  test('YAML inválido se rechaza y cuenta la línea dentro del bloque de propiedades', () => {
    assert.throws(() => separarNota('---\nid: x\ntitle: [sin cerrar\n---\n', MAX), { codigo: 'YAML_INVALIDO', message: /línea 2/ });
  });

  test('un bloque de propiedades que supera el tope se rechaza antes de interpretarlo', () => {
    const grande = `---\n${Array.from({ length: 200 }, (_, i) => `clave${i}: valor`).join('\n')}\n---\n`;
    assert.throws(() => separarNota(grande, 1024), { codigo: 'YAML_GRANDE' });
    assert.doesNotThrow(() => separarNota(grande, 4096));
  });
});
