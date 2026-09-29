import assert from 'node:assert/strict';
import { mkdir, readFile, rmdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { aplicarCambio } from '../src/aplicar.ts';
import { validarArranque } from '../src/arranque.ts';
import type { Contexto } from '../src/arranque.ts';
import {
  prepararActualizacionFuncionalidad,
  prepararActualizacionGuia,
  prepararAdr,
  prepararFuncionalidad,
  prepararGuia,
  prepararIncidencia,
} from '../src/documentos.ts';
import type { DatosFuncionalidad, DatosGuia } from '../src/documentos.ts';
import { separarNota } from '../src/frontmatter.ts';
import { crearGuardia } from '../src/guardia.ts';
import type { Guardia } from '../src/guardia.ts';
import { crearEscenario, escribirNota, notaContadores, notaTarea } from './helpers.ts';
import type { Escenario } from './helpers.ts';
import { indexar } from '../src/notas.ts';
import { prepararTablero } from '../src/tablero.ts';
import { prepararCambioEstado } from '../src/tareas.ts';

const TABLERO = ['---', 'project_id: demo', 'type: referencia', 'schema: 1', 'title: Tablero', '---', 'Tablero de prueba.', '', '%% asyncdv:inicio tablero %%', '%% asyncdv:fin %%', ''].join('\n');

const FUNCIONALIDAD: DatosFuncionalidad = {
  key: 'modulo:quotes',
  titulo: 'Cotizaciones',
  que_hace: 'Arma y envía cotizaciones.',
  afirmaciones: [{ afirmacion: 'Existe el módulo | de pago', evidencia: 'verificado-en-codigo', fuente: 'src/config/modules.ts' }],
  evidence: 'verificado-en-codigo',
  reviewed_commit: '8b4660d',
  fuentes: ['repo:src/config/modules.ts@8b4660d'],
};

const GUIA: DatosGuia = {
  key: 'guia:primeros-pasos',
  titulo: 'Primeros pasos',
  proposito: 'Orienta a quien administra un sitio por primera vez.',
  pasos: '1. Abre el admin.\n2. Revisa el panel.',
  afirmaciones: [{ afirmacion: 'El admin vive en /admin', evidencia: 'solo-documentacion', fuente: 'repo:docs/recetas.md@8b4660d' }],
  evidence: 'solo-documentacion',
  reviewed_commit: '8b4660d',
  fuentes: ['repo:docs/recetas.md@8b4660d'],
};

async function codigoDe(promesa: Promise<unknown>): Promise<string> {
  try {
    await promesa;
    return 'OK';
  } catch (error) {
    return (error as { codigo?: string }).codigo ?? 'OTRO';
  }
}

describe('documentos y tablero', () => {
  let esc: Escenario;
  let ctx: Contexto;
  let g: Guardia;
  const indice = () => indexar(g, ctx.config);

  beforeEach(async () => {
    esc = await crearEscenario();
    await esc.escribirConfig({ limites: { escrituras_por_minuto: 60 } });
    await escribirNota(esc.proyecto, '_contadores.md', notaContadores());
    await escribirNota(esc.proyecto, 'Tablero.md', TABLERO);
    for (const carpeta of ['Tareas', 'Funcionalidades', 'Decisiones', 'Incidencias', 'Guias']) await mkdir(path.join(esc.proyecto, carpeta));
    const estado = await validarArranque(['--config', esc.rutaConfig], {});
    assert.ok(estado.ok, 'el escenario debería arrancar');
    ctx = estado.ctx;
    g = crearGuardia(ctx.proyecto, ctx.config.limites);
  });
  afterEach(async () => {
    await esc.limpiar();
  });

  test('la key de una funcionalidad es única y el | se escapa en la tabla', async () => {
    const p = await prepararFuncionalidad(ctx, g, await indice(), FUNCIONALIDAD);
    assert.match(p.vistaPrevia, /Existe el módulo \\\| de pago/);
    await aplicarCambio(ctx, g, p.confirmacion);
    assert.equal(await codigoDe(prepararFuncionalidad(ctx, g, await indice(), { ...FUNCIONALIDAD, titulo: 'Otra' })), 'KEY_REPETIDA');
  });

  // ——— Versión 1.2.0: funcionalidad_actualizar ———

  const rutaFuncionalidad = () => path.join(esc.proyecto, 'Funcionalidades', 'DEM-F-0001-cotizaciones.md');
  const funcionalidad = async () => (await indice()).notas.find((n) => n.tipo === 'funcionalidad') ?? assert.fail('falta la funcionalidad');
  const crearFuncionalidad = async () => {
    await aplicarCambio(ctx, g, (await prepararFuncionalidad(ctx, g, await indice(), FUNCIONALIDAD)).confirmacion);
    return funcionalidad();
  };
  // El cuerpo con cada bloque gestionado reducido a su nombre: lo que el MCP nunca debe tocar.
  const fueraDeBloques = (texto: string) =>
    separarNota(texto, 1 << 20).cuerpo.replace(/(%% asyncdv:inicio [a-z_]+) h=[0-9a-f]{12} %%[\s\S]*?%% asyncdv:fin %%/g, '$1');

  test('una funcionalidad nace con bloques gestionados, la tabla separada de los marcadores e historial', async () => {
    const nota = await crearFuncionalidad();
    const texto = await readFile(rutaFuncionalidad(), 'utf8');
    assert.match(texto, /%% asyncdv:inicio afirmaciones h=[0-9a-f]{12} %%\n\n\| Afirmación \| Evidencia \| Fuente \|\n\|---\|---\|---\|\n\| Existe el módulo/);
    assert.match(texto, /src\/config\/modules\.ts \|\n\n%% asyncdv:fin %%/);
    assert.match(texto, /%% asyncdv:inicio historial h=[0-9a-f]{12} %%\n- .+ · creada · revisada en 8b4660d · funcionalidad_crear\n%% asyncdv:fin %%/);
    assert.match(texto, /## Notas\nTexto libre tuyo/);
    assert.equal(nota.datos.key, 'modulo:quotes');
  });

  test('actualizar reescribe solo lo pedido: «Notas» y lo de fuera de los bloques quedan idénticos', async () => {
    await crearFuncionalidad();
    const ruta = rutaFuncionalidad();
    await writeFile(ruta, (await readFile(ruta, 'utf8')).replace('Texto libre tuyo: el MCP no lo toca.', 'Nota mía TESTIGO'), 'utf8');
    const antes = await readFile(ruta, 'utf8');
    const nota = await funcionalidad();

    const p = await prepararActualizacionFuncionalidad(ctx, g, await indice(), {
      id: nota.id,
      version_esperada: nota.version,
      pedido_por: 'Ana',
      motivo: 'calc.ts cambió',
      afirmaciones: [{ afirmacion: 'Calcula el IVA', evidencia: 'verificado-en-codigo', fuente: 'repo:src/modules/quotes/services/calc.ts@abc1234' }],
      reviewed_commit: 'abc1234',
      fuentes: ['repo:src/modules/quotes/services/calc.ts@abc1234'],
    });
    assert.equal(await readFile(ruta, 'utf8'), antes, 'preparar no escribe');
    await aplicarCambio(ctx, g, p.confirmacion);

    const texto = await readFile(ruta, 'utf8');
    assert.match(texto, /\| Calcula el IVA \| verificado-en-codigo \|/);
    assert.doesNotMatch(texto, /Existe el módulo/);
    assert.match(texto, /Arma y envía cotizaciones\./, 'que_hace no se pidió: sigue igual');
    assert.match(texto, /actualizada: reviewed_commit, reviewed_on, source, afirmaciones · pidió: Ana · motivo: calc\.ts cambió · funcionalidad_actualizar/);
    assert.equal(fueraDeBloques(texto), fueraDeBloques(antes));

    const actual = await funcionalidad();
    assert.equal(actual.datos.key, 'modulo:quotes');
    assert.equal(actual.datos.reviewed_commit, 'abc1234');
    assert.deepEqual(actual.datos.source, ['repo:src/modules/quotes/services/calc.ts@abc1234']);
  });

  test('sin campos, afirmaciones sin commit, versión vieja, id inexistente y pendiente desconocido se rechazan', async () => {
    const nota = await crearFuncionalidad();
    const base = { id: nota.id, version_esperada: nota.version, pedido_por: 'Ana' };
    const probar = async (d: Partial<typeof base> & Record<string, unknown>) =>
      codigoDe(prepararActualizacionFuncionalidad(ctx, g, await indice(), { ...base, ...d }));
    assert.equal(await probar({}), 'SIN_CAMBIOS');
    assert.equal(await probar({ afirmaciones: FUNCIONALIDAD.afirmaciones }), 'FALTA_COMMIT');
    assert.equal(await probar({ fuentes: ['repo:x.ts@abc1234'] }), 'FALTA_COMMIT');
    assert.equal(await probar({ evidence: 'solo-documentacion' }), 'FALTA_COMMIT');
    assert.equal(await probar({ version_esperada: '0000000000000000', titulo: 'Otro' }), 'CONFLICTO');
    assert.equal(await probar({ id: 'DEM-F-0099', titulo: 'Otro' }), 'NOTA_NO_EXISTE');
    assert.equal(await probar({ pendientes: ['DEM-T-0404'] }), 'ID_DESCONOCIDO');

    // Cambiar solo el título no exige commit, y el archivo no se renombra.
    await aplicarCambio(ctx, g, (await prepararActualizacionFuncionalidad(ctx, g, await indice(), { ...base, titulo: 'Cotizaciones y PDF' })).confirmacion);
    const renombrada = await funcionalidad();
    assert.equal(renombrada.titulo, 'Cotizaciones y PDF');
    assert.equal(renombrada.ruta, nota.ruta);
  });

  test('un bloque editado a mano se advierte antes de pisarlo, y una nota en CRLF sigue en CRLF', async () => {
    await crearFuncionalidad();
    const ruta = rutaFuncionalidad();
    const aMano = (await readFile(ruta, 'utf8')).replace('Arma y envía cotizaciones.', 'Texto escrito a mano.').replace(/\n/g, '\r\n');
    await writeFile(ruta, aMano, 'utf8');
    const nota = await funcionalidad();

    const p = await prepararActualizacionFuncionalidad(ctx, g, await indice(), {
      id: nota.id,
      version_esperada: nota.version,
      pedido_por: 'Ana',
      que_hace: 'Arma cotizaciones\ny las envía en PDF.',
    });
    assert.match(p.vistaPrevia, /ATENCIÓN: el bloque «que_hace» fue editado a mano/);
    await aplicarCambio(ctx, g, p.confirmacion);
    const texto = await readFile(ruta, 'utf8');
    assert.doesNotMatch(texto, /[^\r]\n/, 'todos los saltos siguen en CRLF');
    assert.match(texto, /Arma cotizaciones\r\ny las envía en PDF\./);

    // Al reescribirlo, la huella se renueva: la próxima edición ya no advierte nada.
    const otra = await funcionalidad();
    const q = await prepararActualizacionFuncionalidad(ctx, g, await indice(), { id: otra.id, version_esperada: otra.version, pedido_por: 'Ana', que_hace: 'Otra vez.' });
    assert.doesNotMatch(q.vistaPrevia, /editado a mano/);
  });

  test('una funcionalidad sin bloques (a mano o anterior a la 1.2.0) explica qué falta', async () => {
    await escribirNota(
      esc.proyecto,
      'Funcionalidades/DEM-F-0001-vieja.md',
      ['---', 'id: DEM-F-0001', 'project_id: demo', 'type: funcionalidad', 'schema: 1', 'title: Vieja', 'key: modulo:viejo', '---', '## Qué hace', 'Algo.', ''].join('\n'),
    );
    const nota = await funcionalidad();
    const d = { id: nota.id, version_esperada: nota.version, pedido_por: 'Ana', que_hace: 'Nuevo.' };
    assert.equal(await codigoDe(prepararActualizacionFuncionalidad(ctx, g, await indice(), d)), 'BLOQUE_FALTA');
  });

  test('una guía lleva su propio ID, estrena su contador y comparte las keys con las funcionalidades', async () => {
    const p = await prepararGuia(ctx, g, await indice(), GUIA);
    assert.match(p.vistaPrevia, /Crear Guias\/DEM-G-0001-primeros-pasos\.md/);
    assert.match(p.vistaPrevia, /## Cómo se usa\n%% asyncdv:inicio pasos h=[0-9a-f]{12} %%\n\n1\. Abre el admin\./);
    assert.match(p.vistaPrevia, /%% asyncdv:inicio problemas h=[0-9a-f]{12} %%\n\n\(ninguno registrado\)\n\n%% asyncdv:fin %%/);
    assert.match(p.vistaPrevia, /- .+ · creada · revisada en 8b4660d · guia_crear/);
    await aplicarCambio(ctx, g, p.confirmacion);

    const guia = (await indice()).notas.find((n) => n.tipo === 'guia') ?? assert.fail('falta la guía');
    assert.equal(guia.id, 'DEM-G-0001');
    assert.equal(guia.datos.key, 'guia:primeros-pasos');
    // El _contadores.md de prueba no trae ultimo_G: el MCP lo agrega sin que lo edites a mano.
    assert.match(await readFile(path.join(esc.proyecto, '_contadores.md'), 'utf8'), /^ultimo_G: 1$/m);

    assert.equal(await codigoDe(prepararFuncionalidad(ctx, g, await indice(), { ...FUNCIONALIDAD, key: GUIA.key })), 'KEY_REPETIDA');
    await aplicarCambio(ctx, g, (await prepararFuncionalidad(ctx, g, await indice(), FUNCIONALIDAD)).confirmacion);
    assert.equal(await codigoDe(prepararGuia(ctx, g, await indice(), { ...GUIA, key: FUNCIONALIDAD.key })), 'KEY_REPETIDA');
  });

  // ——— Versión 2.1.0: guia_actualizar ———

  const guia = async () => (await indice()).notas.find((n) => n.tipo === 'guia') ?? assert.fail('falta la guía');

  test('guia_actualizar reescribe solo los bloques pedidos; la key y «Notas» no cambian', async () => {
    await aplicarCambio(ctx, g, (await prepararGuia(ctx, g, await indice(), GUIA)).confirmacion);
    const ruta = path.join(esc.proyecto, 'Guias', 'DEM-G-0001-primeros-pasos.md');
    await writeFile(ruta, (await readFile(ruta, 'utf8')).replace('Texto libre tuyo: el MCP no lo toca.', 'Nota mía TESTIGO'), 'utf8');
    const antes = await readFile(ruta, 'utf8');
    const nota = await guia();

    const p = await prepararActualizacionGuia(ctx, g, await indice(), {
      id: nota.id,
      version_esperada: nota.version,
      pedido_por: 'Ana',
      motivo: 'el panel cambió',
      pasos: '1. Abre /admin.\n2. Elige el sitio.',
      problemas: 'Si no carga, recarga la página.',
    });
    assert.equal(await readFile(ruta, 'utf8'), antes, 'preparar no escribe');
    await aplicarCambio(ctx, g, p.confirmacion);

    const texto = await readFile(ruta, 'utf8');
    assert.match(texto, /1\. Abre \/admin\.\n2\. Elige el sitio\./);
    assert.match(texto, /Si no carga, recarga la página\./);
    assert.doesNotMatch(texto, /ninguno registrado/);
    assert.match(texto, /Orienta a quien administra/, 'propósito no se pidió: sigue igual');
    assert.match(texto, /actualizada: pasos, problemas · pidió: Ana · motivo: el panel cambió · guia_actualizar/);
    assert.equal(fueraDeBloques(texto), fueraDeBloques(antes));
    assert.equal((await guia()).datos.key, GUIA.key);

    // Vaciar «problemas» vuelve al texto por defecto.
    const actual = await guia();
    await aplicarCambio(ctx, g, (await prepararActualizacionGuia(ctx, g, await indice(), { id: actual.id, version_esperada: actual.version, pedido_por: 'Ana', problemas: '' })).confirmacion);
    assert.match(await readFile(ruta, 'utf8'), /\(ninguno registrado\)/);
  });

  test('guia_actualizar solo edita guías y comparte las reglas de funcionalidad_actualizar', async () => {
    const f = await crearFuncionalidad();
    await aplicarCambio(ctx, g, (await prepararGuia(ctx, g, await indice(), GUIA)).confirmacion);
    const nota = await guia();
    const base = { id: nota.id, version_esperada: nota.version, pedido_por: 'Ana' };
    assert.equal(await codigoDe(prepararActualizacionGuia(ctx, g, await indice(), { id: f.id, version_esperada: f.version, pedido_por: 'Ana', pasos: 'x' })), 'NOTA_NO_EXISTE');
    assert.equal(await codigoDe(prepararActualizacionGuia(ctx, g, await indice(), base)), 'SIN_CAMBIOS');
    assert.equal(await codigoDe(prepararActualizacionGuia(ctx, g, await indice(), { ...base, afirmaciones: GUIA.afirmaciones })), 'FALTA_COMMIT');
    assert.equal(await codigoDe(prepararActualizacionGuia(ctx, g, await indice(), { ...base, version_esperada: '0000000000000000', pasos: 'x' })), 'CONFLICTO');
  });

  test('una guia.md propia con el formato anterior a la 2.1.0 sigue creando guías, que no se pueden actualizar', async () => {
    const propias = path.join(esc.base, 'plantillas-anteriores');
    await mkdir(propias);
    const anterior = ['## Para qué sirve', '{{proposito}}', '', '## Cómo se usa', '{{pasos}}', '', '## Problemas frecuentes', '{{problemas}}', '', '## Afirmaciones', '| Afirmación | Evidencia | Fuente |', '|---|---|---|', '{{afirmaciones}}', '', '## Pendientes', '{{pendientes}}', ''];
    await writeFile(path.join(propias, 'guia.md'), anterior.join('\n'), 'utf8');
    await esc.escribirConfig({ limites: { escrituras_por_minuto: 60 }, plantillas_dir: propias });
    const estado = await validarArranque(['--config', esc.rutaConfig], {});
    assert.ok(estado.ok, 'el formato anterior de una plantilla propia se acepta');
    ctx = estado.ctx;

    await aplicarCambio(ctx, g, (await prepararGuia(ctx, g, await indice(), GUIA)).confirmacion);
    const texto = await readFile(path.join(esc.proyecto, 'Guias', 'DEM-G-0001-primeros-pasos.md'), 'utf8');
    assert.match(texto, /## Cómo se usa\n1\. Abre el admin\./);
    assert.match(texto, /\|---\|---\|---\|\n\| El admin vive en \/admin \|/);
    assert.doesNotMatch(texto, /asyncdv:inicio/);

    const nota = await guia();
    const d = { id: nota.id, version_esperada: nota.version, pedido_por: 'Ana', pasos: 'Nuevo.' };
    assert.equal(await codigoDe(prepararActualizacionGuia(ctx, g, await indice(), d)), 'BLOQUE_FALTA');
  });

  test('sin la carpeta Guias no se prepara ninguna guía', async () => {
    await rmdir(path.join(esc.proyecto, 'Guias'));
    assert.equal(await codigoDe(prepararGuia(ctx, g, await indice(), GUIA)), 'CARPETA_NO_EXISTE');
  });

  test('una decisión nace Propuesta y una incidencia usa los estados de las tareas', async () => {
    const adr = await prepararAdr(ctx, g, await indice(), {
      titulo: 'Suspensión con gracia',
      contexto: 'c',
      decision: 'd',
      alternativas: 'a',
      consecuencias: 'x',
      deciders: ['owner'],
      evidence: 'verificado-en-codigo',
      fuentes: ['commit:906b047'],
    });
    await aplicarCambio(ctx, g, adr.confirmacion);
    const nota = (await indice()).notas.find((n) => n.tipo === 'decision') ?? assert.fail('falta la decisión');
    assert.equal(nota.id, 'DEM-ADR-0001');
    assert.equal(nota.datos.decision_status, 'Propuesta');

    const inc = await prepararIncidencia(ctx, g, await indice(), {
      titulo: 'main y develop divergieron',
      sintoma: 's',
      impacto: 'i',
      severity: 'baja',
      environment: 'repositorio',
      detected: '2026-09-27',
      prioridad: 'P2',
      fuentes: ['commit:8b4660d'],
      pedido_por: 'Ana',
    });
    await aplicarCambio(ctx, g, inc.confirmacion);
    const incidencia = (await indice()).notas.find((n) => n.tipo === 'incidencia') ?? assert.fail('falta la incidencia');
    const cambio = await prepararCambioEstado(ctx, g, await indice(), {
      id: incidencia.id,
      version_esperada: incidencia.version,
      pedido_por: 'Ana',
      estado: 'En curso',
    });
    assert.notEqual(cambio, null);
  });

  test('el tablero muestra solo el proyecto, es idempotente y detecta ediciones a mano', async () => {
    await escribirNota(esc.proyecto, 'Tareas/DEM-T-0001-a.md', notaTarea({ id: 'DEM-T-0001', titulo: 'Tarea propia', prioridad: 'P1' }));
    await escribirNota(esc.proyecto, 'Tareas/ajena.md', notaTarea({ id: 'DEM-T-0002', titulo: 'TESTIGO-AJENA', projectId: 'demo-otro' }));
    const primera = (await prepararTablero(ctx, g, await indice())) ?? assert.fail('debería preparar un cambio');
    assert.match(primera.vistaPrevia, /Tarea propia/);
    assert.doesNotMatch(primera.vistaPrevia, /TESTIGO-AJENA/);
    await aplicarCambio(ctx, g, primera.confirmacion);
    assert.equal(await prepararTablero(ctx, g, await indice()), null);

    const ruta = path.join(esc.proyecto, 'Tablero.md');
    await writeFile(ruta, (await readFile(ruta, 'utf8')).replace('Tarea propia', 'Tarea editada a mano'), 'utf8');
    const tercera = (await prepararTablero(ctx, g, await indice())) ?? assert.fail('debería preparar un cambio');
    assert.match(tercera.vistaPrevia, /editado a mano/);
  });
});
