import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { aplicarCambio } from '../src/aplicar.ts';
import { validarArranque } from '../src/arranque.ts';
import type { Contexto } from '../src/arranque.ts';
import { crearGuardia } from '../src/guardia.ts';
import type { Guardia } from '../src/guardia.ts';
import { crearEscenario, escribirNota, notaContadores, notaTarea } from './helpers.ts';
import type { Escenario } from './helpers.ts';
import { indexar } from '../src/notas.ts';
import type { Nota } from '../src/notas.ts';
import type { Preparado } from '../src/cambios.ts';
import { prepararActualizacion, prepararCambioEstado, prepararTareaNueva } from '../src/tareas.ts';
import type { DatosTareaNueva } from '../src/tareas.ts';

const BASE: DatosTareaNueva = {
  titulo: 'Encender el correo por cliente',
  descripcion: 'Pasar a la key por site.',
  criterios: ['Key en Vault', 'Flag encendido'],
  prioridad: 'P1',
  estado_inicial: 'Por hacer',
  pedido_por: 'Ana',
};
const ARCHIVO = 'DEM-T-0001-encender-el-correo-por-cliente.md';

async function codigoDe(promesa: Promise<unknown>): Promise<string> {
  try {
    await promesa;
    return 'OK';
  } catch (error) {
    return (error as { codigo?: string }).codigo ?? 'OTRO';
  }
}

describe('tareas de punta a punta', () => {
  let esc: Escenario;
  let ctx: Contexto;
  let g: Guardia;
  const indice = () => indexar(g, ctx.config);
  const crear = async (d: Partial<DatosTareaNueva> = {}): Promise<Preparado> => {
    const p = await prepararTareaNueva(ctx, g, await indice(), { ...BASE, ...d });
    return 'repetida' in p ? assert.fail(`ya existe ${p.repetida.id}`) : p;
  };
  const tarea = async (id: string): Promise<Nota> => (await indice()).notas.find((n) => n.id === id) ?? assert.fail(`no existe ${id}`);

  beforeEach(async () => {
    esc = await crearEscenario();
    await esc.escribirConfig({ limites: { escrituras_por_minuto: 60 } }); // estas pruebas escriben seguido
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

  test('preparar no escribe; aplicar crea la nota y avanza el contador', async () => {
    const p = await crear();
    assert.match(p.vistaPrevia, /DEM-T-0001/);
    assert.deepEqual(await readdir(path.join(esc.proyecto, 'Tareas')), []);
    await aplicarCambio(ctx, g, p.confirmacion);
    assert.deepEqual(await readdir(path.join(esc.proyecto, 'Tareas')), [ARCHIVO]);
    assert.match(await readFile(path.join(esc.proyecto, '_contadores.md'), 'utf8'), /ultimo_T: 1/);
    assert.deepEqual((await indice()).anomalias, []);
  });

  test('el contador nunca baja ni reutiliza números', async () => {
    await escribirNota(esc.proyecto, '_contadores.md', notaContadores({ ultimo_T: 7 }));
    assert.match((await crear()).vistaPrevia, /DEM-T-0008/);
    await escribirNota(esc.proyecto, 'Tareas/DEM-T-0010-vieja.md', notaTarea({ id: 'DEM-T-0010', titulo: 'Vieja' }));
    assert.match((await crear({ titulo: 'Otra tarea' })).vistaPrevia, /DEM-T-0011/);
  });

  test('no duplica una tarea abierta con el mismo título, pero sí una completada', async () => {
    await aplicarCambio(ctx, g, (await crear()).confirmacion);
    const repetida = await prepararTareaNueva(ctx, g, await indice(), { ...BASE, titulo: '  ENCENDER el correo por cliente ' });
    assert.ok('repetida' in repetida, 'debería devolver la tarea que ya existe');
    assert.equal(repetida.repetida.id, 'DEM-T-0001');
    await escribirNota(esc.proyecto, 'Tareas/DEM-T-0005-cerrada.md', notaTarea({ id: 'DEM-T-0005', titulo: 'Cerrada', estado: 'Completado' }));
    const nueva = await prepararTareaNueva(ctx, g, await indice(), { ...BASE, titulo: 'Cerrada' });
    assert.ok('confirmacion' in nueva, 'una tarea completada no cuenta como repetida');
  });

  test('el texto libre se limpia al entrar: un marcador de bloque se rechaza y lo demás se recorta', async () => {
    assert.equal(await codigoDe(crear({ descripcion: 'hola %% asyncdv:fin %%' })), 'CAMPO_INVALIDO');
    await aplicarCambio(ctx, g, (await crear()).confirmacion);
    const ruta = path.join(esc.proyecto, 'Tareas', ARCHIVO);

    const t1 = await tarea('DEM-T-0001');
    const estado = await prepararCambioEstado(ctx, g, await indice(), { id: t1.id, version_esperada: t1.version, pedido_por: 'Ana', estado: 'Pendiente', motivo: '  espera la promoción  ' });
    await aplicarCambio(ctx, g, (estado ?? assert.fail('debería haber un cambio')).confirmacion);
    assert.match(await readFile(ruta, 'utf8'), /Por hacer → Pendiente · pidió: Ana · motivo: espera la promoción · tarea_cambiar_estado/);

    const t2 = await tarea('DEM-T-0001');
    const criterio = await prepararActualizacion(ctx, g, await indice(), { id: t2.id, version_esperada: t2.version, pedido_por: 'Ana', criterio_nuevo: '  Flag apagado  ' });
    await aplicarCambio(ctx, g, criterio.confirmacion);
    assert.match(await readFile(ruta, 'utf8'), /- \[ \] Flag apagado\n/);
    const t3 = await tarea('DEM-T-0001');
    assert.equal(await codigoDe(prepararActualizacion(ctx, g, await indice(), { id: t3.id, version_esperada: t3.version, pedido_por: 'Ana', criterio_nuevo: '%% asyncdv:fin %%' })), 'CAMPO_INVALIDO');
  });

  test('un código de confirmación sirve una sola vez', async () => {
    const p = await crear();
    await aplicarCambio(ctx, g, p.confirmacion);
    assert.equal(await codigoDe(aplicarCambio(ctx, g, p.confirmacion)), 'CONFIRMACION_INVALIDA');
  });

  test('si otra creación avanzó el contador, la vista previa vieja se rechaza', async () => {
    const vieja = await crear();
    await aplicarCambio(ctx, g, (await crear({ titulo: 'Otra' })).confirmacion);
    assert.equal(await codigoDe(aplicarCambio(ctx, g, vieja.confirmacion)), 'CONFLICTO');
  });

  test('las transiciones inválidas se rechazan y repetir el estado no hace nada', async () => {
    await aplicarCambio(ctx, g, (await crear()).confirmacion);
    const t = await tarea('DEM-T-0001');
    const pedido = { id: t.id, version_esperada: t.version, pedido_por: 'Ana' };
    assert.equal(await codigoDe(prepararCambioEstado(ctx, g, await indice(), { ...pedido, estado: 'Bloqueado' })), 'TRANSICION');
    assert.equal(await codigoDe(prepararCambioEstado(ctx, g, await indice(), { ...pedido, estado: 'Completado', resolution: 'hecha' })), 'TRANSICION');
    assert.equal(await prepararCambioEstado(ctx, g, await indice(), { ...pedido, estado: 'Por hacer' }), null);
  });

  test('el historial crece y lo no gestionado queda idéntico, también con CRLF', async () => {
    await aplicarCambio(ctx, g, (await crear()).confirmacion);
    const ruta = path.join(esc.proyecto, 'Tareas', ARCHIVO);
    const crlf = (await readFile(ruta, 'utf8')).replaceAll('\n', '\r\n').replace('Texto libre tuyo', 'Mis notas ÚNICAS');
    await writeFile(ruta, crlf, 'utf8');
    const t = await tarea('DEM-T-0001');
    const p = await prepararCambioEstado(ctx, g, await indice(), {
      id: t.id,
      version_esperada: t.version,
      pedido_por: 'Ana',
      estado: 'Bloqueado',
      blocked_reason: 'Espera la promoción',
    });
    await aplicarCambio(ctx, g, (p ?? assert.fail('debería haber un cambio')).confirmacion);
    const final = await readFile(ruta, 'utf8');
    assert.ok(!/[^\r]\n/.test(final), 'apareció un salto LF suelto');
    const seccionNotas = (texto: string) => texto.slice(texto.indexOf('## Notas'), texto.indexOf('## Historial'));
    assert.equal(seccionNotas(final), seccionNotas(crlf));
    assert.match(final, /Por hacer → Bloqueado · pidió: Ana/);
    assert.match(final, /status: Bloqueado/);
  });

  test('tarea_actualizar cambia campos, null quita uno, agrega un criterio y exige la versión leída', async () => {
    await aplicarCambio(ctx, g, (await crear({ responsable: 'Ana' })).confirmacion);
    const t = await tarea('DEM-T-0001');
    const pedido = { id: t.id, version_esperada: t.version, pedido_por: 'Ana' };
    assert.equal(await codigoDe(prepararActualizacion(ctx, g, await indice(), pedido)), 'SIN_CAMBIOS');
    const p = await prepararActualizacion(ctx, g, await indice(), { ...pedido, prioridad: 'P0', responsable: null, criterio_nuevo: 'Flag apagado' });
    await aplicarCambio(ctx, g, p.confirmacion);
    const texto = await readFile(path.join(esc.proyecto, 'Tareas', ARCHIVO), 'utf8');
    assert.match(texto, /^priority: P0$/m);
    assert.doesNotMatch(texto, /^assignee:/m);
    assert.match(texto, /- \[ \] Flag encendido\n- \[ \] Flag apagado\n/);
    assert.match(texto, /actualizada: priority, assignee, criterio · pidió: Ana · tarea_actualizar/);
    assert.equal(await codigoDe(prepararActualizacion(ctx, g, await indice(), { ...pedido, prioridad: 'P1' })), 'CONFLICTO', 'la versión leída antes de aplicar ya no vale');
  });

  test('si la nota cambió después de la vista previa, no se escribe nada', async () => {
    await aplicarCambio(ctx, g, (await crear()).confirmacion);
    const t = await tarea('DEM-T-0001');
    const p = await prepararCambioEstado(ctx, g, await indice(), { id: t.id, version_esperada: t.version, pedido_por: 'Ana', estado: 'En curso' });
    const ruta = path.join(esc.proyecto, t.ruta);
    await writeFile(ruta, `${await readFile(ruta, 'utf8')}\nEditado en Obsidian.\n`, 'utf8');
    const antes = await readFile(ruta, 'utf8');
    assert.equal(await codigoDe(aplicarCambio(ctx, g, (p ?? assert.fail('debería haber un cambio')).confirmacion)), 'CONFLICTO');
    assert.equal(await readFile(ruta, 'utf8'), antes);
    assert.deepEqual((await readdir(path.dirname(ruta))).filter((n) => n.endsWith('.tmp')), []);
  });

  test('si otra sesión está escribiendo, se espera el turno', async () => {
    await writeFile(path.join(esc.dirConfig, 'escritura.lock'), 'otra sesión', 'utf8');
    assert.equal(await codigoDe(aplicarCambio(ctx, g, (await crear()).confirmacion)), 'BLOQUEO_OCUPADO');
  });
});
