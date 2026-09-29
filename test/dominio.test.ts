import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { agregarCriterio, ahora, criteriosPendientes, limpiarTextoLibre, problemasDeTransicion, slug } from '../src/dominio.ts';
import type { PedidoTransicion } from '../src/dominio.ts';

describe('dominio', () => {
  test('slug: ASCII, sin tildes y con tope', () => {
    assert.equal(slug('Encender el correo — ¡por cliente!'), 'encender-el-correo-por-cliente');
    assert.equal(slug('???'), 'sin-titulo');
    assert.ok(slug('a'.repeat(100)).length <= 60);
  });

  // ⚠️ Depende de los datos de zonas horarias que trae Node (Chile: -03:00 en verano, -04:00 en invierno).
  test('ahora respeta el desfase de Santiago', () => {
    assert.equal(ahora('America/Santiago', new Date('2026-09-27T21:52:00Z')).legible, '2026-09-27 18:52 (-03:00)');
    assert.equal(ahora('America/Santiago', new Date('2026-07-01T16:00:00Z')).legible, '2026-07-01 12:00 (-04:00)');
  });

  test('reglas de transición', () => {
    const casos: [string, PedidoTransicion, number, boolean][] = [
      ['Por hacer', { destino: 'En curso' }, 0, true],
      ['Por hacer', { destino: 'Bloqueado' }, 0, false],
      ['Por hacer', { destino: 'Bloqueado', blocked_reason: 'Espera la promoción' }, 0, true],
      ['Por hacer', { destino: 'Pendiente' }, 0, false],
      ['En curso', { destino: 'Completado', resolution: 'hecha' }, 1, false],
      ['En curso', { destino: 'Completado', resolution: 'hecha' }, 0, true],
      ['En curso', { destino: 'Completado', resolution: 'cancelada' }, 0, false],
      ['En curso', { destino: 'Completado', resolution: 'cancelada', motivo: 'Ya no aplica' }, 3, true],
      ['Completado', { destino: 'En curso' }, 0, false],
      ['Completado', { destino: 'En curso', motivo: 'Faltó un caso' }, 0, true],
      ['Por hacer', { destino: 'En curso', resolution: 'hecha' }, 0, false],
    ];
    for (const [origen, pedido, pendientes, permitido] of casos) {
      assert.equal(problemasDeTransicion(origen, pedido, pendientes).length === 0, permitido, `${origen} → ${pedido.destino}`);
    }
  });

  test('criterios pendientes y criterio nuevo', () => {
    const cuerpo = '## Criterios de aceptación\n- [x] uno\n- [ ] dos\n\n## Notas\n- [ ] esto no cuenta\n';
    assert.equal(criteriosPendientes(cuerpo), 1);
    const nuevo = agregarCriterio(cuerpo, 'tres', '\n');
    assert.equal(criteriosPendientes(nuevo), 2);
    assert.ok(nuevo.includes('- [ ] dos\n- [ ] tres\n\n## Notas'));
  });

  describe('limpiarTextoLibre', () => {
    test('recorta cada cadena, recorre arreglos y objetos anidados y no toca lo que no es texto', () => {
      const entrada = {
        titulo: '  Encender el correo \n',
        criterios: [' uno', 'dos  '],
        secciones: { corregido: ['  un bug  '] },
        afirmaciones: [{ afirmacion: ' a ', evidencia: 'propuesto' }],
        prioridad: 3,
        activo: true,
        sin: null,
        falta: undefined,
      };
      assert.deepEqual(limpiarTextoLibre(entrada, 64), {
        titulo: 'Encender el correo',
        criterios: ['uno', 'dos'],
        secciones: { corregido: ['un bug'] },
        afirmaciones: [{ afirmacion: 'a', evidencia: 'propuesto' }],
        prioridad: 3,
        activo: true,
        sin: null,
        falta: undefined,
      });
      assert.equal(entrada.titulo, '  Encender el correo \n', 'la entrada no se muta');
      assert.deepEqual(entrada.criterios, [' uno', 'dos  '], 'tampoco sus arreglos');
      assert.deepEqual(entrada.secciones, { corregido: ['  un bug  '] }, 'ni sus objetos anidados');
      assert.equal(entrada.afirmaciones[0]?.afirmacion, ' a ');
    });

    test('deja intacto lo que no es un objeto plano, como una fecha', () => {
      const fecha = new Date('2026-09-29T00:00:00Z');
      assert.equal(limpiarTextoLibre(fecha, 64), fecha);
      assert.deepEqual(limpiarTextoLibre({ detected: fecha, nota: ' x ' }, 64), { detected: fecha, nota: 'x' });
    });

    test('rechaza los marcadores de bloque gestionado y nombra el campo', () => {
      assert.throws(() => limpiarTextoLibre({ descripcion: 'hola %% asyncdv:fin %%' }, 64), {
        codigo: 'CAMPO_INVALIDO',
        message: '«descripcion» no puede contener marcadores «%% asyncdv:».',
      });
      assert.throws(() => limpiarTextoLibre({ secciones: { corregido: ['ok', '%% asyncdv:inicio x %%'] } }, 64), {
        codigo: 'CAMPO_INVALIDO',
        message: '«secciones.corregido[1]» no puede contener marcadores «%% asyncdv:».',
      });
    });

    test('rechaza lo que supera el tope en bytes, no en caracteres', () => {
      assert.throws(() => limpiarTextoLibre({ pasos: 'a'.repeat(1025) }, 1), { codigo: 'CAMPO_GRANDE', message: '«pasos» supera los 1 KB.' });
      assert.throws(() => limpiarTextoLibre({ pasos: 'ñ'.repeat(513) }, 1), { codigo: 'CAMPO_GRANDE' }, 'cada ñ pesa 2 bytes');
      assert.deepEqual(limpiarTextoLibre({ pasos: 'a'.repeat(1024) }, 1), { pasos: 'a'.repeat(1024) });
    });
  });
});
