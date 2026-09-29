import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { cargarConfig } from '../src/config.ts';
import { TIPOS } from '../src/dominio.ts';
import { formatearId } from '../src/ids.ts';
import { cargarPlantilla } from '../src/plantillas.ts';
import { TIPOS_DE_NOTA, TIPOS_NUMERADOS } from '../src/tipos.ts';
import type { TipoDeNota } from '../src/tipos.ts';
import { crearEscenario } from './helpers.ts';
import type { Escenario } from './helpers.ts';

const declarados = Object.keys(TIPOS_DE_NOTA) as TipoDeNota[];

// Un tipo de nota con documento propio se declara una vez, en tipos.ts. Estas pruebas fijan lo que esa declaración
// tiene que seguir diciendo y que el resto del código la lee en vez de repetirla.
describe('declaración de los tipos de nota', () => {
  let esc: Escenario;
  beforeEach(async () => {
    esc = await crearEscenario();
  });
  afterEach(async () => {
    await esc.limpiar();
  });

  test('cada tipo tiene su letra en el id y su carpeta por defecto', async () => {
    const { config } = await cargarConfig(esc.rutaConfig, {});
    const porTipo = Object.fromEntries(declarados.map((t) => [t, [TIPOS_DE_NOTA[t].letra, config.carpetas[TIPOS_DE_NOTA[t].carpeta]]]));
    assert.deepEqual(porTipo, {
      tarea: ['T', 'Tareas'],
      funcionalidad: ['F', 'Funcionalidades'],
      incidencia: ['I', 'Incidencias'],
      decision: ['ADR', 'Decisiones'],
      release: ['R', 'Releases'],
      guia: ['G', 'Guias'],
    });
  });

  test('cada carpeta configurable la usa exactamente un tipo', async () => {
    const { config } = await cargarConfig(esc.rutaConfig, {});
    assert.deepEqual(declarados.map((t) => TIPOS_DE_NOTA[t].carpeta).sort(), Object.keys(config.carpetas).sort());
  });

  test('los tipos que se numeran son todos menos el release, y su id sale de la letra declarada', () => {
    assert.deepEqual([...TIPOS_NUMERADOS].sort(), ['decision', 'funcionalidad', 'guia', 'incidencia', 'tarea']);
    assert.equal(TIPOS_DE_NOTA.release.numerada, false);
    const esperados = { tarea: 'DEM-T-0007', funcionalidad: 'DEM-F-0007', incidencia: 'DEM-I-0007', decision: 'DEM-ADR-0007', guia: 'DEM-G-0007' };
    for (const tipo of TIPOS_NUMERADOS) assert.equal(formatearId('DEM', tipo, 7), esperados[tipo], tipo);
  });

  test('las letras no se repiten', () => {
    const letras = declarados.map((t) => TIPOS_DE_NOTA[t].letra);
    assert.equal(new Set(letras).size, letras.length);
  });

  test('todo tipo declarado es un tipo de nota que el índice reconoce', () => {
    for (const tipo of declarados) assert.ok((TIPOS as readonly string[]).includes(tipo), tipo);
  });

  test('la plantilla que trae el MCP para cada tipo cumple el contrato declarado', async () => {
    for (const tipo of declarados) assert.equal(typeof (await cargarPlantilla(tipo)), 'string', tipo);
  });

  test('el formato anterior de la guía está declarado con los campos que tenía hasta la 2.0.0', () => {
    assert.deepEqual(TIPOS_DE_NOTA.guia.plantilla.anteriores, [{ campos: ['proposito', 'pasos', 'problemas', 'afirmaciones', 'pendientes'], bloques: [] }]);
  });
});
