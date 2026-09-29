import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { aplicarCambio } from '../src/aplicar.ts';
import { validarArranque } from '../src/arranque.ts';
import { crearSesion } from '../src/sesion.ts';
import type { Sesion } from '../src/sesion.ts';
import { conConfig } from './sesiones.ts';
import { codigoDe, crearEscenario, escribirNota, notaContadores, notaTarea } from './helpers.ts';
import type { Escenario } from './helpers.ts';
import { comoLista, filtrar } from '../src/notas.ts';
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

describe('tareas de punta a punta', () => {
  let esc: Escenario;
  let sesion: Sesion;
  const indice = () => sesion.indice();
  const crear = async (d: Partial<DatosTareaNueva> = {}): Promise<Preparado> => {
    const p = await prepararTareaNueva(sesion, { ...BASE, ...d });
    return 'repetida' in p ? assert.fail(`ya existe ${p.repetida.id}`) : p;
  };
  const tarea = async (id: string): Promise<Nota> => (await indice()).notas.find((n) => n.id === id) ?? assert.fail(`no existe ${id}`);

  beforeEach(async () => {
    esc = await crearEscenario();
    await escribirNota(esc.proyecto, '_contadores.md', notaContadores());
    await mkdir(path.join(esc.proyecto, 'Tareas'));
    const estado = await validarArranque(['--config', esc.rutaConfig], {});
    assert.ok(estado.ok, 'el escenario debería arrancar');
    sesion = crearSesion(estado.ctx);
  });
  afterEach(async () => {
    await esc.limpiar();
  });

  test('preparar no escribe; aplicar crea la nota y avanza el contador', async () => {
    const p = await crear();
    assert.match(p.vistaPrevia, /DEM-T-0001/);
    assert.deepEqual(await readdir(path.join(esc.proyecto, 'Tareas')), []);
    await aplicarCambio(sesion, p.confirmacion);
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
    await aplicarCambio(sesion, (await crear()).confirmacion);
    const repetida = await prepararTareaNueva(sesion, { ...BASE, titulo: '  ENCÉNDER   el correo por cliente ' });
    assert.ok('repetida' in repetida, 'sin mayúsculas, sin tildes y con espacios sobrantes debería ser la misma tarea');
    assert.equal(repetida.repetida.id, 'DEM-T-0001');
    const pendienteSinMotivo = await prepararTareaNueva(sesion, { ...BASE, estado_inicial: 'Pendiente' });
    assert.ok('repetida' in pendienteSinMotivo, 'la repetida se detecta antes de exigir el motivo de «Pendiente»');
    await escribirNota(esc.proyecto, 'Tareas/DEM-T-0005-cerrada.md', notaTarea({ id: 'DEM-T-0005', titulo: 'Cerrada', estado: 'Completado' }));
    const nueva = await prepararTareaNueva(sesion, { ...BASE, titulo: 'Cerrada' });
    assert.ok('confirmacion' in nueva, 'una tarea completada no cuenta como repetida');
  });

  test('el texto libre se limpia al entrar: un marcador de bloque se rechaza y lo demás se recorta', async () => {
    assert.equal(await codigoDe(crear({ descripcion: 'hola %% asyncdv:fin %%' })), 'CAMPO_INVALIDO');
    await aplicarCambio(sesion, (await crear()).confirmacion);
    const ruta = path.join(esc.proyecto, 'Tareas', ARCHIVO);

    const t1 = await tarea('DEM-T-0001');
    const conMarcador = { id: t1.id, version_esperada: t1.version, pedido_por: 'Ana', estado: 'Pendiente' as const, motivo: 'x %% asyncdv:fin %%' };
    assert.equal(await codigoDe(prepararCambioEstado(sesion, conMarcador)), 'CAMPO_INVALIDO');
    const estado = await prepararCambioEstado(sesion, { id: t1.id, version_esperada: t1.version, pedido_por: 'Ana', estado: 'Pendiente', motivo: '  espera la promoción  ' });
    await aplicarCambio(sesion, (estado ?? assert.fail('debería haber un cambio')).confirmacion);
    assert.match(await readFile(ruta, 'utf8'), /Por hacer → Pendiente · pidió: Ana · motivo: espera la promoción · tarea_cambiar_estado/);

    const t2 = await tarea('DEM-T-0001');
    const criterio = await prepararActualizacion(sesion, { id: t2.id, version_esperada: t2.version, pedido_por: 'Ana', criterio_nuevo: '  Flag apagado  ' });
    await aplicarCambio(sesion, criterio.confirmacion);
    assert.match(await readFile(ruta, 'utf8'), /- \[ \] Flag apagado\n/);
    const t3 = await tarea('DEM-T-0001');
    assert.equal(await codigoDe(prepararActualizacion(sesion, { id: t3.id, version_esperada: t3.version, pedido_por: 'Ana', criterio_nuevo: '%% asyncdv:fin %%' })), 'CAMPO_INVALIDO');
  });

  test('sin pedido_por se usa el usuario configurado, ya limpio; sin ninguno, FALTA_PEDIDO_POR, pero después de validar el texto', async () => {
    const { pedido_por: _quitado, ...sinPedido } = BASE;
    const conUsuario = conConfig(sesion, (c) => ({ ...c, usuario: '  Beatriz  ' }));
    const nueva = await prepararTareaNueva(conUsuario, sinPedido);
    assert.ok('confirmacion' in nueva);
    assert.match(nueva.vistaPrevia, /creada en «Por hacer» · pidió: Beatriz · tarea_crear/, 'sin los espacios del usuario configurado');
    await aplicarCambio(conUsuario, nueva.confirmacion);
    const creada = await tarea('DEM-T-0001');
    const estado = await prepararCambioEstado(conUsuario, { id: creada.id, version_esperada: creada.version, estado: 'En curso' });
    assert.match((estado ?? assert.fail('debería haber un cambio')).vistaPrevia, /Por hacer → En curso · pidió: Beatriz · tarea_cambiar_estado/);
    const criterio = await prepararActualizacion(conUsuario, { id: creada.id, version_esperada: creada.version, criterio_nuevo: 'Otro criterio' });
    assert.match(criterio.vistaPrevia, /actualizada: criterio · pidió: Beatriz/);
    const explicito = await prepararActualizacion(conUsuario, { id: creada.id, version_esperada: creada.version, pedido_por: 'Ana', criterio_nuevo: 'Otro criterio' });
    assert.match(explicito.vistaPrevia, /actualizada: criterio · pidió: Ana/);
    assert.doesNotMatch(explicito.vistaPrevia, /actualizada: criterio · pidió: Beatriz/, 'el explícito gana');
    const conMarcador = conConfig(sesion, (c) => ({ ...c, usuario: 'Bea %% asyncdv:fin %%' }));
    assert.equal(await codigoDe(prepararTareaNueva(conMarcador, sinPedido)), 'CAMPO_INVALIDO', 'el usuario configurado se valida como cualquier texto libre');

    const MARCADOR = 'x %% asyncdv:fin %%';
    const conTextoInvalido: [string, () => Promise<unknown>][] = [
      ['tarea_crear', () => prepararTareaNueva(sesion, { ...sinPedido, descripcion: MARCADOR })],
      ['tarea_cambiar_estado', () => prepararCambioEstado(sesion, { id: creada.id, version_esperada: creada.version, estado: 'Pendiente', motivo: MARCADOR })],
      ['tarea_actualizar', () => prepararActualizacion(sesion, { id: creada.id, version_esperada: creada.version, criterio_nuevo: MARCADOR })],
    ];
    for (const [herramienta, preparar] of conTextoInvalido) assert.equal(await codigoDe(preparar()), 'CAMPO_INVALIDO', `${herramienta}: primero el texto y después quién lo pide`);
    assert.equal(await codigoDe(prepararTareaNueva(sesion, sinPedido)), 'FALTA_PEDIDO_POR');
  });

  test('cambiar de estado escribe blocked_by, ignora un motivo en blanco y quita la resolución al reabrir', async () => {
    await aplicarCambio(sesion, (await crear({ titulo: 'A' })).confirmacion);
    await aplicarCambio(sesion, (await crear({ titulo: 'B' })).confirmacion);
    const rutaB = path.join(esc.proyecto, 'Tareas', 'DEM-T-0002-b.md');
    const cambiar = async (d: { estado: 'Bloqueado' | 'Completado' | 'Por hacer'; blocked_by?: string[]; blocked_reason?: string; resolution?: 'cancelada'; motivo?: string }): Promise<string> => {
      const b = await tarea('DEM-T-0002');
      const p = await prepararCambioEstado(sesion, { ...d, id: b.id, version_esperada: b.version, pedido_por: 'Ana' });
      await aplicarCambio(sesion, (p ?? assert.fail('debería haber un cambio')).confirmacion);
      return readFile(rutaB, 'utf8');
    };
    const bloqueada = await cambiar({ estado: 'Bloqueado', blocked_by: ['DEM-T-0001'], blocked_reason: '   ' });
    assert.match(bloqueada, /^blocked_by:\n  - .*DEM-T-0001/m);
    assert.doesNotMatch(bloqueada, /^blocked_reason:/m, 'un motivo en blanco no se escribe');
    const completada = await cambiar({ estado: 'Completado', resolution: 'cancelada', motivo: 'ya no aplica' });
    assert.match(completada, /^resolution: cancelada$/m);
    const reabierta = await cambiar({ estado: 'Por hacer', motivo: 'sí aplica' });
    assert.doesNotMatch(reabierta, /^resolution:/m, 'reabrir quita la resolución anterior');
  });

  test('actualizar pone release, responsable y due, y quita con null el release y el responsable', async () => {
    await escribirNota(esc.proyecto, 'Releases/DEM-R-v1.0.0.md', ['---', 'id: DEM-R-v1.0.0', 'project_id: demo', 'type: release', 'schema: 1', 'title: Primera', 'release_status: Borrador', '---', ''].join('\n'));
    await aplicarCambio(sesion, (await crear()).confirmacion);
    const ruta = path.join(esc.proyecto, 'Tareas', ARCHIVO);
    const actualizar = async (d: { release?: string | null; responsable?: string | null; due?: string | null }): Promise<string> => {
      const t = await tarea('DEM-T-0001');
      await aplicarCambio(sesion, (await prepararActualizacion(sesion, { ...d, id: t.id, version_esperada: t.version, pedido_por: 'Ana' })).confirmacion);
      return readFile(ruta, 'utf8');
    };
    const puesta = await actualizar({ release: 'DEM-R-v1.0.0', responsable: 'Ana', due: '2026-10-01' });
    assert.match(puesta, /^release: .*DEM-R-v1\.0\.0/m);
    assert.match(puesta, /^assignee: Ana$/m);
    assert.match(puesta, /^due: 2026-10-01$/m);
    const quitada = await actualizar({ release: null, responsable: null });
    assert.doesNotMatch(quitada, /^release:/m);
    assert.doesNotMatch(quitada, /^assignee:/m);
    assert.match(quitada, /^due: 2026-10-01$/m, 'lo que no se nombró queda como estaba');
  });

  test('un código de confirmación sirve una sola vez', async () => {
    const p = await crear();
    await aplicarCambio(sesion, p.confirmacion);
    assert.equal(await codigoDe(aplicarCambio(sesion, p.confirmacion)), 'CONFIRMACION_INVALIDA');
  });

  test('si otra creación avanzó el contador, la vista previa vieja se rechaza', async () => {
    const vieja = await crear();
    await aplicarCambio(sesion, (await crear({ titulo: 'Otra' })).confirmacion);
    assert.equal(await codigoDe(aplicarCambio(sesion, vieja.confirmacion)), 'CONFLICTO');
  });

  test('las transiciones inválidas se rechazan y repetir el estado no hace nada', async () => {
    await aplicarCambio(sesion, (await crear()).confirmacion);
    const t = await tarea('DEM-T-0001');
    const pedido = { id: t.id, version_esperada: t.version, pedido_por: 'Ana' };
    assert.equal(await codigoDe(prepararCambioEstado(sesion, { ...pedido, estado: 'Bloqueado' })), 'TRANSICION');
    assert.equal(await codigoDe(prepararCambioEstado(sesion, { ...pedido, estado: 'Completado', resolution: 'hecha' })), 'TRANSICION');
    assert.equal(await prepararCambioEstado(sesion, { ...pedido, estado: 'Por hacer' }), null);
  });

  test('el historial crece y lo no gestionado queda idéntico, también con CRLF', async () => {
    await aplicarCambio(sesion, (await crear()).confirmacion);
    const ruta = path.join(esc.proyecto, 'Tareas', ARCHIVO);
    const crlf = (await readFile(ruta, 'utf8')).replaceAll('\n', '\r\n').replace('Texto libre tuyo', 'Mis notas ÚNICAS');
    await writeFile(ruta, crlf, 'utf8');
    const t = await tarea('DEM-T-0001');
    const p = await prepararCambioEstado(sesion, {
      id: t.id,
      version_esperada: t.version,
      pedido_por: 'Ana',
      estado: 'Bloqueado',
      blocked_reason: 'Espera la promoción',
    });
    await aplicarCambio(sesion, (p ?? assert.fail('debería haber un cambio')).confirmacion);
    const final = await readFile(ruta, 'utf8');
    assert.ok(!/[^\r]\n/.test(final), 'apareció un salto LF suelto');
    const seccionNotas = (texto: string) => texto.slice(texto.indexOf('## Notas'), texto.indexOf('## Historial'));
    assert.equal(seccionNotas(final), seccionNotas(crlf));
    assert.match(final, /Por hacer → Bloqueado · pidió: Ana/);
    assert.match(final, /status: Bloqueado/);
  });

  test('tarea_actualizar cambia campos, null quita uno, agrega un criterio y exige la versión leída', async () => {
    await aplicarCambio(sesion, (await crear({ responsable: 'Ana' })).confirmacion);
    const t = await tarea('DEM-T-0001');
    const pedido = { id: t.id, version_esperada: t.version, pedido_por: 'Ana' };
    assert.equal(await codigoDe(prepararActualizacion(sesion, pedido)), 'SIN_CAMBIOS');
    const p = await prepararActualizacion(sesion, { ...pedido, prioridad: 'P0', responsable: null, criterio_nuevo: 'Flag apagado' });
    await aplicarCambio(sesion, p.confirmacion);
    const texto = await readFile(path.join(esc.proyecto, 'Tareas', ARCHIVO), 'utf8');
    assert.match(texto, /^priority: P0$/m);
    assert.doesNotMatch(texto, /^assignee:/m);
    assert.match(texto, /- \[ \] Flag encendido\n- \[ \] Flag apagado\n/);
    assert.match(texto, /actualizada: priority, assignee, criterio · pidió: Ana · tarea_actualizar/);
    assert.equal(await codigoDe(prepararActualizacion(sesion, { ...pedido, prioridad: 'P1' })), 'CONFLICTO', 'la versión leída antes de aplicar ya no vale');
  });

  test('si la nota cambió después de la vista previa, no se escribe nada', async () => {
    await aplicarCambio(sesion, (await crear()).confirmacion);
    const t = await tarea('DEM-T-0001');
    const p = await prepararCambioEstado(sesion, { id: t.id, version_esperada: t.version, pedido_por: 'Ana', estado: 'En curso' });
    const ruta = path.join(esc.proyecto, t.ruta);
    await writeFile(ruta, `${await readFile(ruta, 'utf8')}\nEditado en Obsidian.\n`, 'utf8');
    const antes = await readFile(ruta, 'utf8');
    assert.equal(await codigoDe(aplicarCambio(sesion, (p ?? assert.fail('debería haber un cambio')).confirmacion)), 'CONFLICTO');
    assert.equal(await readFile(ruta, 'utf8'), antes);
    assert.deepEqual((await readdir(path.dirname(ruta))).filter((n) => n.endsWith('.tmp')), []);
  });

  test('si otra sesión está escribiendo, se espera el turno', async () => {
    await writeFile(path.join(esc.dirConfig, 'escritura.lock'), 'otra sesión', 'utf8');
    assert.equal(await codigoDe(aplicarCambio(sesion, (await crear()).confirmacion)), 'BLOQUEO_OCUPADO');
  });

  test('un bloqueo de hace más de un minuto se avisa como antiguo y no se borra solo', async () => {
    const bloqueo = path.join(esc.dirConfig, 'escritura.lock');
    await writeFile(bloqueo, 'sesión que murió', 'utf8');
    const haceDosMinutos = new Date(Date.now() - 120_000);
    await utimes(bloqueo, haceDosMinutos, haceDosMinutos);
    assert.equal(await codigoDe(aplicarCambio(sesion, (await crear()).confirmacion)), 'BLOQUEO_ANTIGUO');
    assert.equal(await readFile(bloqueo, 'utf8'), 'sesión que murió', 'lo borra la persona, no el MCP');
  });

  // Decisión pendiente: al salir de «Bloqueado» no se borran blocked_by ni blocked_reason, y filtrar por
  // depende_de sigue encontrando la tarea aunque ya no esté bloqueada. Esta prueba fija lo que pasa hoy.
  test('hoy, al salir de «Bloqueado» la tarea conserva blocked_by y blocked_reason', async () => {
    await aplicarCambio(sesion, (await crear()).confirmacion);
    await aplicarCambio(sesion, (await crear({ titulo: 'Otra tarea' })).confirmacion);
    const pedido = { pedido_por: 'Ana' };

    const antes = await tarea('DEM-T-0002');
    const bloquear = await prepararCambioEstado(sesion, { ...pedido, id: antes.id, version_esperada: antes.version, estado: 'Bloqueado', blocked_by: ['DEM-T-0001'], blocked_reason: 'espera la key' });
    await aplicarCambio(sesion, (bloquear ?? assert.fail('debería haber un cambio')).confirmacion);

    const bloqueada = await tarea('DEM-T-0002');
    const liberar = await prepararCambioEstado(sesion, { ...pedido, id: bloqueada.id, version_esperada: bloqueada.version, estado: 'En curso' });
    await aplicarCambio(sesion, (liberar ?? assert.fail('debería haber un cambio')).confirmacion);

    const liberada = await tarea('DEM-T-0002');
    assert.equal(liberada.datos.status, 'En curso');
    assert.equal(liberada.datos.blocked_reason, 'espera la key');
    assert.equal(comoLista(liberada.datos.blocked_by).length, 1);
    assert.deepEqual(filtrar(await indice(), { depende_de: 'DEM-T-0001' }).map((n) => n.id), ['DEM-T-0002']);
  });
});
