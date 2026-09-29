import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { crearAlmacen, crearTope } from '../src/almacen.ts';
import type { Cambio } from '../src/cambios.ts';
import { ErrorMcp } from '../src/errores.ts';
import { relojFalso } from './helpers.ts';

const cambio = (descripcion: string): Cambio => ({ descripcion, operaciones: [] });
const MINUTO = 60_000;

function codigoDeAccion(accion: () => unknown): string {
  try {
    accion();
  } catch (error) {
    if (error instanceof ErrorMcp) return error.codigo;
    throw error;
  }
  return 'NO FALLÓ';
}

describe('almacén de cambios preparados', () => {
  test('un código entrega su cambio una sola vez', () => {
    const almacen = crearAlmacen(relojFalso(), 5);
    const pedido = cambio('a');
    const { confirmacion, minutos } = almacen.guardar(pedido);
    assert.equal(minutos, 5, 'dice cuánto tarda en vencer');
    assert.equal(almacen.retirar(confirmacion), pedido);
    assert.equal(codigoDeAccion(() => almacen.retirar(confirmacion)), 'CONFIRMACION_INVALIDA');
  });

  test('el código son 128 bits aleatorios, distintos en cada cambio', () => {
    const almacen = crearAlmacen(relojFalso(), 5);
    const codigos = new Set(Array.from({ length: 200 }, () => almacen.guardar(cambio('a')).confirmacion));
    assert.equal(codigos.size, 200);
    for (const codigo of codigos) assert.match(codigo, /^[A-Za-z0-9_-]{22}$/, '16 bytes en base64url');
  });

  test('cada cambio recibe su propio código y un código inventado no sirve', () => {
    const almacen = crearAlmacen(relojFalso(), 5);
    const codigoA = almacen.guardar(cambio('a')).confirmacion;
    const codigoB = almacen.guardar(cambio('b')).confirmacion;
    assert.equal(almacen.retirar(codigoB).descripcion, 'b');
    assert.equal(almacen.retirar(codigoA).descripcion, 'a');
    assert.equal(codigoDeAccion(() => almacen.retirar('no-existe')), 'CONFIRMACION_INVALIDA');
  });

  test('el código vence a los minutos del almacén y no un instante antes', () => {
    const reloj = relojFalso();
    const almacen = crearAlmacen(reloj, 5);
    const primero = almacen.guardar(cambio('a')).confirmacion;
    reloj.avanzar(5 * MINUTO - 1);
    assert.equal(almacen.retirar(primero).descripcion, 'a', 'un milisegundo antes todavía sirve');

    const segundo = almacen.guardar(cambio('b')).confirmacion;
    reloj.avanzar(5 * MINUTO);
    assert.equal(codigoDeAccion(() => almacen.retirar(segundo)), 'CONFIRMACION_INVALIDA', 'al cumplirse el plazo ya venció');
  });

  test('cada almacén vence según los minutos con que se creó', () => {
    const reloj = relojFalso();
    const corto = crearAlmacen(reloj, 1);
    const largo = crearAlmacen(reloj, 10);
    const codigoCorto = corto.guardar(cambio('corto')).confirmacion;
    const codigoLargo = largo.guardar(cambio('largo')).confirmacion;
    reloj.avanzar(2 * MINUTO);
    assert.equal(codigoDeAccion(() => corto.retirar(codigoCorto)), 'CONFIRMACION_INVALIDA');
    assert.equal(largo.retirar(codigoLargo).descripcion, 'largo');
  });
});

describe('tope de escrituras por minuto', () => {
  test('deja pasar hasta el tope y después responde LIMITE', () => {
    const tope = crearTope(relojFalso(), 2);
    tope.exigir();
    tope.contar();
    tope.exigir();
    tope.contar();
    assert.equal(codigoDeAccion(() => tope.exigir()), 'LIMITE');
  });

  test('exigir no gasta cupo: solo cuenta lo que se cuenta', () => {
    const tope = crearTope(relojFalso(), 1);
    for (let i = 0; i < 5; i++) tope.exigir();
    tope.contar();
    assert.equal(codigoDeAccion(() => tope.exigir()), 'LIMITE');
  });

  test('la ventana es deslizante: cada cupo se libera un minuto después de gastarse', () => {
    const reloj = relojFalso();
    const tope = crearTope(reloj, 2);
    tope.contar();
    reloj.avanzar(30_000);
    tope.contar();
    reloj.avanzar(MINUTO - 30_001); // 59 999 ms desde la primera
    assert.equal(codigoDeAccion(() => tope.exigir()), 'LIMITE');
    reloj.avanzar(1); // 60 000 ms: la primera sale de la ventana
    tope.exigir();
    tope.contar();
    assert.equal(codigoDeAccion(() => tope.exigir()), 'LIMITE', 'la segunda sigue dentro');
    reloj.avanzar(30_000);
    tope.exigir();
  });

  test('el mensaje dice cuál es el tope', () => {
    const tope = crearTope(relojFalso(), 3);
    for (let i = 0; i < 3; i++) tope.contar();
    assert.throws(() => tope.exigir(), /3 escrituras por minuto/);
  });
});
