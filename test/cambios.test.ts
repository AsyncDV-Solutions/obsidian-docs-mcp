import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { validarArranque } from '../src/arranque.ts';
import type { Contexto } from '../src/arranque.ts';
import { escribirBloque } from '../src/bloques.ts';
import { crear, editar, regenerarBloque, tomar } from '../src/cambios.ts';
import { crearGuardia } from '../src/guardia.ts';
import type { Guardia } from '../src/guardia.ts';
import { indexar } from '../src/notas.ts';
import { crearEscenario, escribirNota, notaContadores, notaTarea } from './helpers.ts';
import type { Escenario } from './helpers.ts';

async function codigoDe(promesa: Promise<unknown>): Promise<string> {
  try {
    await promesa;
    return 'OK';
  } catch (error) {
    return (error as { codigo?: string }).codigo ?? 'OTRO';
  }
}

// Una nota con un bloque gestionado vacío, como el Tablero.md que crea «pnpm run iniciar».
function notaConBloque(projectId = 'demo'): string {
  return ['---', `project_id: ${projectId}`, 'type: referencia', 'schema: 1', 'title: Tablero', '---', 'Texto tuyo.', '', '%% asyncdv:inicio tablero %%', '%% asyncdv:fin %%', ''].join('\n');
}

describe('cambios preparados', () => {
  let esc: Escenario;
  let ctx: Contexto;
  let g: Guardia;
  const rutaDe = (relativa: string): string => path.join(esc.proyecto, ...relativa.split('/'));

  beforeEach(async () => {
    esc = await crearEscenario();
    await escribirNota(esc.proyecto, '_contadores.md', notaContadores());
    await mkdir(path.join(esc.proyecto, 'Tareas'));
    const estado = await validarArranque(['--config', esc.rutaConfig], {});
    assert.ok(estado.ok, 'el escenario debería arrancar');
    ctx = estado.ctx;
    g = crearGuardia(ctx.proyecto, ctx.config.limites);
  });
  afterEach(async () => {
    await esc.limpiar();
  });

  describe('regenerarBloque', () => {
    test('prepara el reemplazo y la vista previa sale de la operación', async () => {
      await escribirNota(esc.proyecto, 'Tablero.md', notaConBloque());
      const p = await regenerarBloque(ctx, g, 'Tablero.md', 'tablero', '- hola');
      assert.ok(p !== null);
      assert.match(p.vistaPrevia, /^Cambios en Tablero\.md:\n/);
      assert.match(p.vistaPrevia, /^\+ - hola$/m);
      assert.match(p.vistaPrevia, /^\+ updated: /m);
      assert.ok(p.confirmacion.length >= 16);
      assert.ok(p.expira.getTime() > Date.now());
      assert.equal(await readFile(rutaDe('Tablero.md'), 'utf8'), notaConBloque(), 'preparar no escribe');
    });

    test('devuelve null si el bloque ya tiene ese contenido', async () => {
      await escribirNota(esc.proyecto, 'Tablero.md', escribirBloque(notaConBloque(), 'tablero', '- hola', '\n'));
      assert.equal(await regenerarBloque(ctx, g, 'Tablero.md', 'tablero', '- hola'), null);
    });

    test('un bloque editado a mano se regenera igual, con aviso al inicio', async () => {
      const escrita = escribirBloque(notaConBloque(), 'tablero', '- hola', '\n');
      await writeFile(rutaDe('Tablero.md'), escrita.replace('- hola', '- hola editado'), 'utf8');
      const p = await regenerarBloque(ctx, g, 'Tablero.md', 'tablero', '- hola editado');
      assert.ok(p !== null, 'aunque el texto coincida, la huella no: hay que renovarla');
      assert.match(p.vistaPrevia, /^ATENCIÓN: el bloque «tablero» fue editado a mano/);
    });

    test('rechaza una nota ajena, un bloque inexistente y una nota que no existe', async () => {
      await escribirNota(esc.proyecto, 'Ajena.md', notaConBloque('otro'));
      await escribirNota(esc.proyecto, 'Tablero.md', notaConBloque());
      assert.equal(await codigoDe(regenerarBloque(ctx, g, 'Ajena.md', 'tablero', 'x')), 'PROJECT_ID_AJENO');
      assert.equal(await codigoDe(regenerarBloque(ctx, g, 'Tablero.md', 'otro', 'x')), 'BLOQUE_FALTA');
      assert.equal(await codigoDe(regenerarBloque(ctx, g, 'NoExiste.md', 'tablero', 'x')), 'NOTA_NO_EXISTE');
    });
  });

  describe('crear', () => {
    const TAREA = {
      tipo: 'tarea',
      id: { numerar: 'tarea' },
      carpeta: 'Tareas',
      titulo: 'Encender el correo',
      propiedades: { status: 'Por hacer', priority: 'P1', area: [], assignee: undefined },
      valores: { descripcion: 'Pasar la key por site.', criterios: '- [ ] Key en Vault' },
      historial: 'creada en «Por hacer» · pidió: Ana',
      herramienta: 'tarea_crear',
    } as const;

    test('con numerar: arma la nota, avanza el contador y la vista previa muestra las dos operaciones', async () => {
      const p = await crear(ctx, g, await indexar(g, ctx.config), TAREA);
      const [nota, contadores] = p.vistaPrevia.split('Cambios en _contadores.md:\n');
      assert.match(nota ?? '', /^Crear Tareas\/DEM-T-0001-encender-el-correo\.md:\n———\n---\nid: DEM-T-0001\nproject_id: demo\ntype: tarea\nschema: 1\ntitle: Encender el correo\nstatus: Por hacer\npriority: P1\narea: \[\]\ncreated: \d{4}-\d{2}-\d{2}\nupdated: /);
      assert.doesNotMatch(nota ?? '', /assignee/, 'una propiedad undefined se omite');
      assert.match(nota ?? '', /Pasar la key por site\.\n/);
      assert.match(nota ?? '', /- \[ \] Key en Vault\n/);
      assert.match(nota ?? '', /%% asyncdv:inicio historial h=[0-9a-f]{12} %%\n- \d{4}-\d{2}-\d{2} \d{2}:\d{2} \([+-]\d{2}:\d{2}\) · creada en «Por hacer» · pidió: Ana · tarea_crear\n%% asyncdv:fin %%/);
      assert.match(nota ?? '', /\n———\n$/);
      assert.match(contadores ?? '', /^- ultimo_T: 0\n\+ ultimo_T: 1\n/m);
      const ops = tomar(p.confirmacion, 10).operaciones;
      assert.deepEqual(ops.map((o) => `${o.tipo} ${o.ruta}`), ['reemplazar _contadores.md', 'crear Tareas/DEM-T-0001-encender-el-correo.md']);
      assert.equal(ops[0]?.tipo === 'reemplazar' ? ops[0].versionEsperada : '', (await g.leer('_contadores.md')).version);
    });

    test('con id explícito: una sola operación, sin tocar los contadores, y los bloques de la plantilla se rellenan', async () => {
      await mkdir(path.join(esc.proyecto, 'Releases'));
      const p = await crear(ctx, g, await indexar(g, ctx.config), {
        tipo: 'release',
        id: 'DEM-R-v1.0.0',
        carpeta: 'Releases',
        titulo: 'Primera',
        propiedades: { version: '1.0.0' },
        valores: {},
        bloques: { release: '## Resumen\nTodo nuevo.' },
        herramienta: 'release_borrador_guardar',
      });
      assert.match(p.vistaPrevia, /^Crear Releases\/DEM-R-v1\.0\.0\.md:\n———\n---\nid: DEM-R-v1\.0\.0\n/);
      assert.doesNotMatch(p.vistaPrevia, /Cambios en/);
      assert.match(p.vistaPrevia, /%% asyncdv:inicio release h=[0-9a-f]{12} %%\n## Resumen\nTodo nuevo\.\n%% asyncdv:fin %%/);
      assert.equal(tomar(p.confirmacion, 10).operaciones.length, 1);
    });

    test('sin contadores válidos no se numera', async () => {
      await escribirNota(esc.proyecto, '_contadores.md', notaContadores().replace('project_id: demo', 'project_id: otro'));
      assert.equal(await codigoDe(crear(ctx, g, await indexar(g, ctx.config), TAREA)), 'CONTADORES_INVALIDO');
      await rm(rutaDe('_contadores.md'));
      assert.equal(await codigoDe(crear(ctx, g, await indexar(g, ctx.config), TAREA)), 'CONTADORES_FALTA');
    });
  });

  describe('editar', () => {
    const CUERPO = ['## Descripción', 'Texto.', '', '## Criterios de aceptación', '- [ ] a', '', '## Notas', 'mío', '', '## Historial', '%% asyncdv:inicio historial %%', '%% asyncdv:fin %%', ''].join('\n');
    const RUTA = 'Tareas/DEM-T-0001-x.md';
    const notaIndexada = async (id = 'DEM-T-0001') => (await indexar(g, ctx.config)).notas.find((n) => n.id === id) ?? assert.fail(`no existe ${id}`);

    test('propiedades (null borra), bloques, cuerpo e historial; BOM y CRLF quedan como estaban', async () => {
      const original = `\uFEFF${notaTarea({ id: 'DEM-T-0001', titulo: 'X', extra: ['assignee: Ana'], cuerpo: CUERPO }).replaceAll('\n', '\r\n')}`;
      await writeFile(rutaDe(RUTA), original, 'utf8');
      const p = await editar(ctx, g, await notaIndexada(), {
        herramienta: 'tarea_actualizar',
        historial: 'actualizada: priority, assignee, criterio · pidió: Ana',
        propiedades: [
          ['priority', 'P0'],
          ['assignee', null],
        ],
        cuerpo: (cuerpo, eol) => cuerpo.replace('- [ ] a', `- [ ] a${eol}- [ ] b`),
      });
      assert.match(p.vistaPrevia, /^Cambios en Tareas\/DEM-T-0001-x\.md:\n/);
      assert.match(p.vistaPrevia, /^- priority: P2\n- assignee: Ana\n\+ priority: P0\n\+ updated: /m);
      assert.match(p.vistaPrevia, /^\+ - \[ \] b$/m);
      assert.match(p.vistaPrevia, /^\+ - \d{4}-\d{2}-\d{2} \d{2}:\d{2} \([+-]\d{2}:\d{2}\) · actualizada: priority, assignee, criterio · pidió: Ana · tarea_actualizar$/m);
      const [op] = tomar(p.confirmacion, 10).operaciones;
      assert.ok(op?.tipo === 'reemplazar');
      assert.equal(op.versionEsperada, (await notaIndexada()).version);
      assert.ok(op.contenido.startsWith('\uFEFF'), 'se perdió el BOM');
      assert.ok(!/[^\r]\n/.test(op.contenido), 'apareció un salto LF suelto');
      assert.ok(op.contenido.includes('## Notas\r\nmío\r\n'), 'lo no gestionado cambió');
      assert.doesNotMatch(op.contenido, /^assignee:/m);
      assert.equal(await readFile(rutaDe(RUTA), 'utf8'), original, 'preparar no escribe');
    });

    test('un bloque pedido debe existir; si fue editado a mano, avisa antes de la vista previa', async () => {
      const conBloque = notaTarea({ id: 'DEM-T-0001', titulo: 'X', cuerpo: `${CUERPO}%% asyncdv:inicio que_hace %%\n%% asyncdv:fin %%\n` });
      await writeFile(rutaDe(RUTA), conBloque, 'utf8');
      assert.equal(await codigoDe(editar(ctx, g, await notaIndexada(), { herramienta: 'x', bloques: { pendientes: 'y' } })), 'BLOQUE_FALTA');
      await writeFile(rutaDe(RUTA), escribirBloque(conBloque, 'que_hace', 'escrito', '\n').replace('escrito', 'escrito y editado'), 'utf8');
      const p = await editar(ctx, g, await notaIndexada(), { herramienta: 'x', bloques: { que_hace: 'nuevo' }, avisos: ['Aviso propio.'] });
      assert.match(p.vistaPrevia, /^Aviso propio\.\nATENCIÓN: el bloque «que_hace» fue editado a mano; al aplicar se pierden esos cambios\.\nCambios en /);
      assert.match(p.vistaPrevia, /^\+ nuevo$/m);
    });

    test('sin historial no se agrega línea; con historial, el bloque debe existir', async () => {
      const sinHistorial = notaTarea({ id: 'DEM-T-0001', titulo: 'X', cuerpo: '## Descripción\nTexto.\n' });
      await writeFile(rutaDe(RUTA), sinHistorial, 'utf8');
      const p = await editar(ctx, g, await notaIndexada(), { herramienta: 'x', propiedades: [['priority', 'P3']] });
      assert.match(p.vistaPrevia, /\+ priority: P3/);
      assert.doesNotMatch(p.vistaPrevia, /· x$/m);
      assert.equal(await codigoDe(editar(ctx, g, await notaIndexada(), { herramienta: 'x', historial: 'algo', propiedades: [['priority', 'P3']] })), 'BLOQUE_FALTA');
    });

    test('si la nota cambió desde que se indexó, no se prepara nada', async () => {
      await writeFile(rutaDe(RUTA), notaTarea({ id: 'DEM-T-0001', titulo: 'X', cuerpo: CUERPO }), 'utf8');
      const nota = await notaIndexada();
      await writeFile(rutaDe(RUTA), `${await readFile(rutaDe(RUTA), 'utf8')}Editado en Obsidian.\n`, 'utf8');
      assert.equal(await codigoDe(editar(ctx, g, nota, { herramienta: 'x', propiedades: [['priority', 'P3']] })), 'CONFLICTO');
    });
  });

  describe('código de confirmación', () => {
    test('sirve una sola vez', async () => {
      await escribirNota(esc.proyecto, 'Tablero.md', notaConBloque());
      const p = await regenerarBloque(ctx, g, 'Tablero.md', 'tablero', '- hola');
      assert.ok(p !== null);
      assert.equal(tomar(p.confirmacion, 10).operaciones.length, 1);
      assert.throws(() => tomar(p.confirmacion, 10), { codigo: 'CONFIRMACION_INVALIDA' });
    });

    test('un código vencido se rechaza', async () => {
      await escribirNota(esc.proyecto, 'Tablero.md', notaConBloque());
      const sinPlazo = { ...ctx, config: { ...ctx.config, limites: { ...ctx.config.limites, confirmacion_minutos: 0 } } };
      const p = await regenerarBloque(sinPlazo, g, 'Tablero.md', 'tablero', '- hola');
      assert.ok(p !== null);
      assert.throws(() => tomar(p.confirmacion, 10), { codigo: 'CONFIRMACION_INVALIDA' });
    });

    test('el tope de escrituras por minuto no consume el código', async () => {
      await escribirNota(esc.proyecto, 'Tablero.md', notaConBloque());
      const p = await regenerarBloque(ctx, g, 'Tablero.md', 'tablero', '- hola');
      assert.ok(p !== null);
      assert.throws(() => tomar(p.confirmacion, 0), { codigo: 'LIMITE' });
      assert.equal(tomar(p.confirmacion, 10).descripcion, 'regenerar tablero de Tablero.md');
    });
  });
});
