import assert from 'node:assert/strict';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { validarArranque } from '../src/arranque.ts';
import { crearEscenario, escribirNota, notaContadores, servir } from './helpers.ts';
import type { Cliente, Escenario } from './helpers.ts';

const TAREA = { titulo: 'Encender el correo', descripcion: 'Pasar la key por site.', criterios: ['Key en Vault'], prioridad: 'P1', pedido_por: 'Ana' };
const ARCHIVO = 'DEM-T-0001-encender-el-correo.md';
const CODIGO = /confirmacion="([A-Za-z0-9_-]{16,})"/;

describe('servidor MCP, por sus herramientas', () => {
  let esc: Escenario;
  let cliente: Cliente;
  const carpetaTareas = (): string => path.join(esc.proyecto, 'Tareas');

  beforeEach(async () => {
    esc = await crearEscenario();
    await esc.escribirConfig({ limites: { escrituras_por_minuto: 60 } }); // estas pruebas aplican seguido
    await escribirNota(esc.proyecto, '_contadores.md', notaContadores());
    await mkdir(carpetaTareas());
    const estado = await validarArranque(['--config', esc.rutaConfig], {});
    assert.ok(estado.ok, 'el escenario debería arrancar');
    cliente = await servir(estado);
  });
  afterEach(async () => {
    await cliente.cerrar();
    await esc.limpiar();
  });

  test('ofrece las 21 herramientas', async () => {
    assert.deepEqual(await cliente.herramientas(), [
      'adr_crear',
      'cambio_aplicar',
      'funcionalidad_actualizar',
      'funcionalidad_crear',
      'guia_actualizar',
      'guia_crear',
      'incidencia_crear',
      'items_listar',
      'nota_leer',
      'notas_buscar',
      'notas_desactualizadas',
      'proyecto_estado',
      'release_borrador_guardar',
      'release_proponer',
      'repo_archivo_leer',
      'repo_git_resumen',
      'repo_inventario',
      'tablero_regenerar',
      'tarea_actualizar',
      'tarea_cambiar_estado',
      'tarea_crear',
    ]);
  });

  test('tarea_crear prepara sin escribir y cambio_aplicar aplica con el código de la vista previa', async () => {
    const preparada = await cliente.llamar('tarea_crear', TAREA);
    assert.equal(preparada.error, false);
    assert.match(preparada.texto, /^VISTA PREVIA: todavía no se escribió nada\.\nCrear Tareas\/DEM-T-0001-encender-el-correo\.md:\n/);
    assert.match(preparada.texto, /Vence en 5 min y sirve una sola vez\.$/);
    assert.deepEqual(await readdir(carpetaTareas()), [], 'preparar no escribe');

    const codigo = CODIGO.exec(preparada.texto)?.[1] ?? assert.fail('la respuesta no trae el código de confirmación');
    const aplicada = await cliente.llamar('cambio_aplicar', { confirmacion: codigo });
    assert.equal(aplicada.texto, `Aplicado:\n- reemplazar _contadores.md\n- crear Tareas/${ARCHIVO}`);
    assert.match(await readFile(path.join(carpetaTareas(), ARCHIVO), 'utf8'), /^id: DEM-T-0001$/m);

    const otraVez = await cliente.llamar('cambio_aplicar', { confirmacion: codigo });
    assert.equal(otraVez.texto, '[CONFIRMACION_INVALIDA] El código no existe, ya se usó o venció. Vuelve a preparar el cambio.');
    assert.equal(otraVez.error, true);
  });

  test('una tarea abierta con el mismo título no se vuelve a preparar', async () => {
    const codigo = CODIGO.exec((await cliente.llamar('tarea_crear', TAREA)).texto)?.[1] ?? assert.fail('sin código');
    await cliente.llamar('cambio_aplicar', { confirmacion: codigo });
    const repetida = await cliente.llamar('tarea_crear', { ...TAREA, titulo: '  ENCENDER el correo  ' });
    assert.equal(repetida.error, false, 'es un aviso, no un error');
    assert.equal(repetida.texto, `Ya existe DEM-T-0001 (Por hacer) con ese título: Tareas/${ARCHIVO}. No se preparó nada.`);
  });

  test('un marcador de bloque en el texto se rechaza con su código y nombra el campo', async () => {
    const r = await cliente.llamar('tarea_crear', { ...TAREA, criterios: ['bien', 'mal %% asyncdv:fin %%'] });
    assert.equal(r.error, true);
    assert.equal(r.texto, '[CAMPO_INVALIDO] «criterios[1]» no puede contener marcadores «%% asyncdv:».');
    assert.deepEqual(await readdir(carpetaTareas()), []);
  });

  test('sin pedido_por ni usuario configurado responde FALTA_PEDIDO_POR', async () => {
    const { pedido_por: _quitado, ...sinPedido } = TAREA;
    const r = await cliente.llamar('tarea_crear', sinPedido);
    assert.equal(r.error, true);
    assert.match(r.texto, /^\[FALTA_PEDIDO_POR\] /);
  });

  // Lo que el esquema rechaza llega con el texto de zod y sin código estable: por eso la regla de texto
  // libre vive en el dominio y no en el esquema, que solo cubre la forma de la entrada.
  test('una entrada que rompe el esquema responde con isError y el texto de zod, sin código estable', async () => {
    const r = await cliente.llamar('tarea_crear', { ...TAREA, prioridad: 'P9' });
    assert.equal(r.error, true);
    assert.match(r.texto, /^Input validation error: Invalid arguments for tool tarea_crear: prioridad: /);
    assert.doesNotMatch(r.texto, /^\[[A-Z_]+\]/);
  });

  test('la versión que entrega nota_leer sirve para editar la nota', async () => {
    const codigo = CODIGO.exec((await cliente.llamar('tarea_crear', TAREA)).texto)?.[1] ?? assert.fail('sin código');
    await cliente.llamar('cambio_aplicar', { confirmacion: codigo });
    const leida = await cliente.llamar('nota_leer', { id: 'DEM-T-0001' });
    const version = /^version: ([0-9a-f]{16})$/m.exec(leida.texto)?.[1] ?? assert.fail('nota_leer no entregó una versión de 16 caracteres');
    const edicion = await cliente.llamar('tarea_actualizar', { id: 'DEM-T-0001', version_esperada: version, pedido_por: 'Ana', prioridad: 'P0' });
    assert.equal(edicion.error, false);
    assert.match(edicion.texto, /^VISTA PREVIA: todavía no se escribió nada\.\nCambios en Tareas\/DEM-T-0001-encender-el-correo\.md:\n/);
    assert.match(edicion.texto, /^\+ priority: P0$/m);
  });

  test('con la configuración rota, las herramientas de notas responden BLOQUEADO y proyecto_estado explica por qué', async () => {
    await esc.escribirConfig({ repo_path: path.join(esc.base, 'no-existe') });
    const estado = await validarArranque(['--config', esc.rutaConfig], {});
    assert.ok(!estado.ok, 'la configuración rota no debería arrancar');
    const roto = await servir(estado);
    try {
      const bloqueada = await roto.llamar('tarea_crear', TAREA);
      assert.equal(bloqueada.texto, '[BLOQUEADO] La configuración tiene problemas: usa proyecto_estado para ver cuáles.');
      assert.equal(bloqueada.error, true);
      const diagnostico = await roto.llamar('proyecto_estado');
      assert.equal(diagnostico.error, false);
      assert.match(diagnostico.texto, /^Configuración con problemas\. Las herramientas de notas están bloqueadas:\n- \[RUTA_NO_EXISTE\] /);
    } finally {
      await roto.cerrar();
    }
  });
});
