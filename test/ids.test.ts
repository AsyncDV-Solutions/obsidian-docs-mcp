import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { claveContador, contadoresIniciales, enlace, formatearId, idDeEnlace, idDeRelease, idValido, patronId, PATRON_ID_RELEASE, PATRON_PREFIJO, siguienteNumero } from '../src/ids.ts';
import type { Nota } from '../src/notas.ts';

const PROYECTO = { config: { project_dir: 'Proyectos/demo' } };

const nota = (id: string): Nota => ({ ruta: `${id}.md`, version: 'v', id, tipo: 'tarea', titulo: id, datos: {}, cuerpo: '' });

describe('ids', () => {
  test('formatear: prefijo, letra del tipo y número con cuatro cifras como mínimo', () => {
    assert.equal(formatearId('DEM', 'tarea', 7), 'DEM-T-0007');
    assert.equal(formatearId('DEM', 'funcionalidad', 3), 'DEM-F-0003');
    assert.equal(formatearId('DEM', 'incidencia', 1), 'DEM-I-0001');
    assert.equal(formatearId('DEM', 'decision', 12345), 'DEM-ADR-12345');
    assert.equal(formatearId('DEM', 'guia', 3), 'DEM-G-0003');
    assert.equal(idDeRelease('DEM', '1.2.3'), 'DEM-R-v1.2.3');
  });

  test('validar: un id vale solo para su tipo y su prefijo', () => {
    const casos: [string, string, boolean][] = [
      ['DEM-T-0001', 'tarea', true],
      ['DEM-T-001', 'tarea', false], // menos de cuatro cifras
      ['DEM-F-0001', 'tarea', false], // letra de otro tipo
      ['OTR-T-0001', 'tarea', false], // otro prefijo
      ['DEM-ADR-0004', 'decision', true],
      ['DEM-R-v1.0.0', 'release', true],
      ['DEM-R-v1.0', 'release', false],
      ['', 'proyecto', true], // el marcador, los contadores y las referencias no llevan id
      ['DEM-T-0001', 'proyecto', false],
    ];
    for (const [id, tipo, esperado] of casos) assert.equal(idValido(id, tipo, 'DEM'), esperado, `${id} como ${tipo}`);
  });

  test('los patrones de las herramientas aceptan cualquier prefijo del proyecto y solo las letras pedidas', () => {
    const notas = patronId('tarea', 'funcionalidad', 'incidencia', 'decision', 'guia');
    for (const id of ['DEM-T-0001', 'AB-F-12345', 'ABCDE-ADR-0001', 'DEM-G-0002', 'DEM-I-0003']) assert.ok(notas.test(id), id);
    for (const id of ['D-T-0001', 'ABCDEF-T-0001', 'dem-T-0001', 'DEM-X-0001', 'DEM-T-001', 'DEM-R-v1.0.0']) assert.ok(!notas.test(id), id);

    const tareas = patronId('tarea', 'incidencia');
    assert.ok(tareas.test('DEM-T-0001') && tareas.test('DEM-I-0001'));
    assert.ok(!tareas.test('DEM-F-0001'));

    assert.ok(PATRON_ID_RELEASE.test('DEM-R-v1.0.0') && !PATRON_ID_RELEASE.test('DEM-R-v1.0') && !PATRON_ID_RELEASE.test('DEM-T-0001'));
    assert.ok(PATRON_PREFIJO.test('DEM') && !PATRON_PREFIJO.test('D') && !PATRON_PREFIJO.test('ABCDEF') && !PATRON_PREFIJO.test('dem'));
  });

  test('enlace e idDeEnlace son inversos para todos los tipos', () => {
    for (const [ruta, id] of [
      ['Tareas/DEM-T-0001-encender-el-correo.md', 'DEM-T-0001'],
      ['Decisiones/DEM-ADR-0002-usar-x.md', 'DEM-ADR-0002'],
      ['Releases/DEM-R-v1.2.3.md', 'DEM-R-v1.2.3'],
    ] as const) {
      const escrito = enlace(PROYECTO, ruta, id);
      assert.equal(escrito, `[[Proyectos/demo/${ruta.replace(/\.md$/, '')}|${id}]]`);
      assert.equal(idDeEnlace(escrito), id);
    }
  });

  test('idDeEnlace: un id suelto, un enlace sin ruta, lo que no es un id y los ids que se parecen', () => {
    assert.equal(idDeEnlace('DEM-T-0001'), 'DEM-T-0001');
    assert.equal(idDeEnlace('[[DEM-T-0001]]'), 'DEM-T-0001');
    assert.equal(idDeEnlace('[[Notas/Idea suelta|la idea]]'), 'Idea suelta');
    assert.equal(idDeEnlace('texto cualquiera'), 'texto cualquiera');
    assert.equal(idDeEnlace('[[Proyectos/demo/Tareas/DEM-T-00010-x|DEM-T-00010]]'), 'DEM-T-00010', 'DEM-T-00010 no es DEM-T-0001');
  });

  test('contadores: una clave por tipo y un contenido inicial con todos en cero, en el orden de las letras', () => {
    assert.equal(claveContador('decision'), 'ultimo_ADR');
    assert.deepEqual(Object.keys(contadoresIniciales()), ['ultimo_T', 'ultimo_F', 'ultimo_I', 'ultimo_ADR', 'ultimo_G']);
    assert.ok(Object.values(contadoresIniciales()).every((n) => n === 0));
  });

  test('el siguiente número nunca baja del contador guardado ni del mayor id existente', () => {
    assert.equal(siguienteNumero('tarea', 'DEM', {}, []), 1);
    assert.equal(siguienteNumero('tarea', 'DEM', { ultimo_T: 7 }, []), 8);
    assert.equal(siguienteNumero('tarea', 'DEM', { ultimo_T: 7 }, [nota('DEM-T-0010')]), 11);
    assert.equal(siguienteNumero('tarea', 'DEM', { ultimo_T: 'siete' }, [nota('DEM-T-0002')]), 3, 'un contador que no es número se ignora');
    assert.equal(siguienteNumero('tarea', 'DEM', {}, [nota('OTR-T-0050'), nota('DEM-F-0060')]), 1, 'ni otro prefijo ni otro tipo cuentan');
  });
});
