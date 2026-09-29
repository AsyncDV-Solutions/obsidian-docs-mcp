import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { crearAlmacen, crearTope } from '../src/almacen.ts';
import type { Cambio } from '../src/cambios.ts';
import { ErrorMcp } from '../src/errores.ts';
import { relojFalso } from './helpers.ts';

const cambio = (descripcion: string): Cambio => ({ descripcion, operaciones: [] });
const MINUTO = 60_000;

function codigoDe(accion: () => unknown): string {
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
    const almacen = crearAlmacen(relojFalso());
    const pedido = cambio('a');
    const { confirmacion } = almacen.guardar(pedido, 5);
    assert.ok(confirmacion.length >= 16, 'el código no se puede adivinar');
    assert.equal(almacen.retirar(confirmacion), pedido);
    assert.equal(codigoDe(() => almacen.retirar(confirmacion)), 'CONFIRMACION_INVALIDA');
  });

  test('cada cambio recibe su propio código y un código inventado no sirve', () => {
    const almacen = crearAlmacen(relojFalso());
    const a = almacen.guardar(cambio('a'), 5).confirmacion;
    const b = almacen.guardar(cambio('b'), 5).confirmacion;
    assert.notEqual(a, b);
    assert.equal(almacen.retirar(b).descripcion, 'b');
    assert.equal(almacen.retirar(a).descripcion, 'a');
    assert.equal(codigoDe(() => almacen.retirar('no-existe')), 'CONFIRMACION_INVALIDA');
  });

  test('el código vence a los minutos pedidos y no un instante antes', () => {
    const reloj = relojFalso();
    const almacen = crearAlmacen(reloj);
    const { confirmacion, expira } = almacen.guardar(cambio('a'), 5);
    assert.equal(expira.getTime(), reloj() + 5 * MINUTO);
    reloj.avanzar(5 * MINUTO - 1);
    assert.equal(almacen.retirar(confirmacion).descripcion, 'a', 'un milisegundo antes todavía sirve');

    const otro = almacen.guardar(cambio('b'), 5).confirmacion;
    reloj.avanzar(5 * MINUTO);
    assert.equal(codigoDe(() => almacen.retirar(otro)), 'CONFIRMACION_INVALIDA', 'al cumplirse el plazo ya venció');
  });

  test('cada código vence según los minutos con que se guardó', () => {
    const reloj = relojFalso();
    const almacen = crearAlmacen(reloj);
    const corto = almacen.guardar(cambio('corto'), 1).confirmacion;
    const largo = almacen.guardar(cambio('largo'), 10).confirmacion;
    reloj.avanzar(2 * MINUTO);
    assert.equal(codigoDe(() => almacen.retirar(corto)), 'CONFIRMACION_INVALIDA');
    assert.equal(almacen.retirar(largo).descripcion, 'largo');
  });
});

describe('tope de escrituras por minuto', () => {
  test('deja pasar hasta el tope y después responde LIMITE', () => {
    const tope = crearTope(relojFalso(), 2);
    tope.exigir();
    tope.contar();
    tope.exigir();
    tope.contar();
    assert.equal(codigoDe(() => tope.exigir()), 'LIMITE');
  });

  test('exigir no gasta cupo: solo cuenta lo que se cuenta', () => {
    const tope = crearTope(relojFalso(), 1);
    for (let i = 0; i < 5; i++) tope.exigir();
    tope.contar();
    assert.equal(codigoDe(() => tope.exigir()), 'LIMITE');
  });

  test('la ventana es deslizante: cada cupo se libera un minuto después de gastarse', () => {
    const reloj = relojFalso();
    const tope = crearTope(reloj, 2);
    tope.contar();
    reloj.avanzar(30_000);
    tope.contar();
    reloj.avanzar(MINUTO - 30_001); // 59 999 ms desde la primera
    assert.equal(codigoDe(() => tope.exigir()), 'LIMITE');
    reloj.avanzar(1); // 60 000 ms: la primera sale de la ventana
    tope.exigir();
    tope.contar();
    assert.equal(codigoDe(() => tope.exigir()), 'LIMITE', 'la segunda sigue dentro');
    reloj.avanzar(30_000);
    tope.exigir();
  });

  test('el mensaje dice cuál es el tope', () => {
    const tope = crearTope(relojFalso(), 3);
    for (let i = 0; i < 3; i++) tope.contar();
    assert.throws(() => tope.exigir(), /3 escrituras por minuto/);
  });
});
