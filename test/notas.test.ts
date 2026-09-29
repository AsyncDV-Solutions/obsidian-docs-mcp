import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { cargarConfig } from '../src/config.ts';
import type { Config } from '../src/config.ts';
import { crearGuardia } from '../src/guardia.ts';
import { buscar, conteoDeNotas, estadoDe, filtrar, indexar, leerNota, leerNotaDelProyecto, mencionaId } from '../src/notas.ts';
import type { Indice, Nota } from '../src/notas.ts';
import { codigoDe, crearEscenario, escribirNota, notaTarea } from './helpers.ts';
import type { Escenario } from './helpers.ts';

describe('índice y consultas', () => {
  let esc: Escenario;
  let config: Config;
  const indice = () => indexar(crearGuardia(esc.proyecto, config.limites), config);

  beforeEach(async () => {
    esc = await crearEscenario();
    config = (await cargarConfig(esc.rutaConfig, {})).config;
    const p = esc.proyecto;
    await escribirNota(p, 'Tareas/DEM-T-0001-login.md', notaTarea({ id: 'DEM-T-0001', titulo: 'Revisar el login', estado: 'En curso', prioridad: 'P1' }));
    await escribirNota(
      p,
      'Tareas/DEM-T-0002-correo.md',
      notaTarea({ id: 'DEM-T-0002', titulo: 'Encender el correo', estado: 'Bloqueado', extra: ['blocked_by:', '  - "[[Proyectos/demo/Tareas/DEM-T-0001-login|DEM-T-0001]]"'] }),
    );
    await escribirNota(p, 'Tareas/ajena.md', notaTarea({ id: 'DEM-T-0003', titulo: 'Ajena', projectId: 'demo-otro' }));
    await escribirNota(p, 'Tareas/sin-id.md', '---\ntype: tarea\n---\nsin project_id\n');
    await escribirNota(p, 'Tareas/rota.md', '---\nproject_id: demo\ntitle: [sin cerrar\n---\n');
    await escribirNota(p, 'Tareas/repetida.md', notaTarea({ id: 'DEM-T-0001', titulo: 'Copia' }));
    await escribirNota(p, 'Tareas/tipo-raro.md', '---\nproject_id: demo\ntype: cosa\n---\ntipo que el MCP no conoce\n');
    await escribirNota(p, 'Tareas/id-malo.md', notaTarea({ id: 'XYZ-9', titulo: 'Id con otro formato' }));
    // Carpeta hermana con un nombre parecido: la guardia nunca debe verla.
    await escribirNota(esc.vault, 'Proyectos/demo-otro/Tareas/x.md', notaTarea({ id: 'DEM-T-0009', titulo: 'TESTIGO-HERMANA' }));
  });
  afterEach(async () => {
    await esc.limpiar();
  });

  test('solo entran las notas con el project_id exacto', async () => {
    const { notas } = await indice();
    assert.deepEqual(notas.map((n) => n.id).filter(Boolean).sort(), ['DEM-T-0001', 'DEM-T-0002']);
  });

  test('las anomalías se reportan y no se corrigen', async () => {
    const { anomalias } = await indice();
    const porRuta = Object.fromEntries(anomalias.map((a) => [a.ruta, a.problema]));
    assert.equal(porRuta['Tareas/ajena.md'], 'PROJECT_ID_AJENO');
    assert.equal(porRuta['Tareas/sin-id.md'], 'SIN_PROJECT_ID');
    assert.equal(porRuta['Tareas/rota.md'], 'YAML_INVALIDO');
    assert.match(porRuta['Tareas/repetida.md'] ?? '', /^ID_DUPLICADO/);
    assert.equal(porRuta['Tareas/tipo-raro.md'], 'TIPO_DESCONOCIDO');
    assert.equal(porRuta['Tareas/id-malo.md'], 'ID_INVALIDO');
  });

  test('el texto de la carpeta hermana nunca aparece', async () => {
    const idx = await indice();
    assert.deepEqual(buscar(idx, 'testigo-hermana', {}, 50), []);
    assert.ok(!idx.anomalias.some((a) => a.ruta.includes('demo-otro')));
  });

  test('buscar no distingue mayúsculas ni tildes', async () => {
    const idx = await indice();
    assert.deepEqual(buscar(idx, 'CORRÉO', {}, 50).map((h) => h.id), ['DEM-T-0002']);
  });

  test('filtrar por estado y por dependencia', async () => {
    const idx = await indice();
    assert.deepEqual(filtrar(idx, { tipo: 'tarea', estado: 'Bloqueado' }).map((n) => n.id), ['DEM-T-0002']);
    assert.deepEqual(filtrar(idx, { depende_de: 'DEM-T-0001' }).map((n) => n.id), ['DEM-T-0002']);
  });

  test('estadoDe toma el estado que corresponde a cada tipo de nota', () => {
    const nota = (datos: Record<string, unknown>): Nota => ({ ruta: 'x.md', version: 'v', id: 'X', tipo: 't', titulo: 'x', datos, cuerpo: '' });
    assert.equal(estadoDe(nota({ status: 'En curso' })), 'En curso');
    assert.equal(estadoDe(nota({ decision_status: 'Propuesta' })), 'Propuesta');
    assert.equal(estadoDe(nota({ release_status: 'Borrador' })), 'Borrador');
    assert.equal(estadoDe(nota({})), '', 'una funcionalidad o una guía no tienen estado');
    assert.equal(estadoDe(nota({ status: 'Por hacer', decision_status: 'Propuesta' })), 'Por hacer', 'status manda');
  });

  test('leerNotaDelProyecto lee una nota del proyecto y rechaza la de otro proyecto o la que no dice de cuál es', async () => {
    const g = crearGuardia(esc.proyecto, config.limites);
    const leida = await leerNotaDelProyecto(g, config, 'Tareas/DEM-T-0001-login.md');
    assert.equal(leida.ruta, 'Tareas/DEM-T-0001-login.md');
    assert.match(leida.version, /^[0-9a-f]{16}$/);
    assert.match(leida.texto, /^---\nid: DEM-T-0001\n/);
    assert.equal(await codigoDe(leerNotaDelProyecto(g, config, 'Tareas/ajena.md')), 'PROJECT_ID_AJENO');
    assert.equal(await codigoDe(leerNotaDelProyecto(g, config, 'Tareas/sin-id.md')), 'PROJECT_ID_AJENO');
    assert.equal(await codigoDe(leerNotaDelProyecto(g, config, 'Tareas/rota.md')), 'YAML_INVALIDO');
    assert.equal(await codigoDe(leerNotaDelProyecto(g, config, 'Tareas/no-existe.md')), 'NOTA_NO_EXISTE');
  });

  test('leerNota lee por id o por ruta, y exige uno de los dos', async () => {
    const g = crearGuardia(esc.proyecto, config.limites);
    const porRuta = await leerNota(g, config, { ruta: 'Tareas/DEM-T-0002-correo.md' });
    assert.equal(porRuta.ruta, 'Tareas/DEM-T-0002-correo.md');
    assert.deepEqual(await leerNota(g, config, { id: 'DEM-T-0002' }), porRuta, 'el id lleva a la misma nota');
    assert.equal(await codigoDe(leerNota(g, config, {})), 'ARGUMENTOS', 'ninguno');
    assert.equal(await codigoDe(leerNota(g, config, { id: 'DEM-T-0002', ruta: 'Tareas/DEM-T-0002-correo.md' })), 'ARGUMENTOS', 'los dos');
    assert.equal(await codigoDe(leerNota(g, config, { id: 'DEM-T-0099' })), 'NOTA_NO_EXISTE');
    assert.equal(await codigoDe(leerNota(g, config, { id: 'DEM-T-0003' })), 'NOTA_NO_EXISTE', 'la nota de otro proyecto no está en el índice');
    assert.equal(await codigoDe(leerNota(g, config, { ruta: 'Tareas/ajena.md' })), 'PROJECT_ID_AJENO');
  });

  test('conteoDeNotas cuenta las tareas por estado y las demás notas por tipo', () => {
    const nota = (tipo: string, datos: Record<string, unknown> = {}): Nota => ({ ruta: `${tipo}.md`, version: 'v', id: tipo, tipo, titulo: tipo, datos, cuerpo: '' });
    const vacio: Indice = { notas: [], anomalias: [], truncado: false };
    assert.deepEqual(conteoDeNotas(vacio), {});
    const conteo = conteoDeNotas({
      ...vacio,
      notas: [nota('tarea', { status: 'En curso' }), nota('tarea', { status: 'En curso' }), nota('tarea', { status: 'Bloqueado' }), nota('tarea'), nota('incidencia', { status: 'En curso' }), nota('guia'), nota('guia')],
    });
    assert.deepEqual(conteo, { 'tarea · En curso': 2, 'tarea · Bloqueado': 1, 'tarea · sin estado': 1, incidencia: 1, guia: 2 });
  });

  test('mencionaId reconoce el id exacto en un enlace y no confunde ids que se parecen', () => {
    const enlaceA = (nombre: string): string => `[[Proyectos/demo/Tareas/${nombre}|x]]`;
    for (const nombre of ['DEM-T-0001', 'DEM-T-0001-login', 'DEM-T-0001#Sección', 'DEM-T-0001^bloque', 'DEM-T-0001.md', 'DEM-T-0001.md#Sección']) {
      assert.equal(mencionaId([enlaceA(nombre)], 'DEM-T-0001'), true, nombre);
    }
    for (const nombre of ['DEM-T-00010-x', 'DEM-T-0001x', 'DEM-T-0001 copia', 'DEM-T-0001_x', 'DEM-T-0002']) {
      assert.equal(mencionaId([enlaceA(nombre)], 'DEM-T-0001'), false, nombre);
    }
    assert.equal(mencionaId('DEM-T-0001', 'DEM-T-0001'), true, 'un id suelto, sin lista');
    assert.equal(mencionaId([enlaceA('DEM-R-v1.0.0')], 'DEM-R-v1.0.0'), true);
    assert.equal(mencionaId([enlaceA('DEM-R-v1.0.0.1')], 'DEM-R-v1.0.0'), false, 'una versión con más partes es otro release');
    assert.equal(mencionaId([enlaceA('DEM-T-0001-login')], 'DEM-T'), false, 'el filtro es un id exacto, no un prefijo');
  });
});
