import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { cargarConfig } from '../src/config.ts';
import { TIPOS, TIPOS_ITEM } from '../src/dominio.ts';
import { ErrorMcp } from '../src/errores.ts';
import { formatearId, idDeRelease, idValido, PATRON_ID_RELEASE } from '../src/ids.ts';
import { cargarPlantilla } from '../src/plantillas.ts';
import { TIPOS_DE_NOTA, TIPOS_DECLARADOS, TIPOS_NUMERADOS } from '../src/tipos.ts';
import type { TipoDeNota } from '../src/tipos.ts';
import { crearEscenario } from './helpers.ts';
import type { Escenario } from './helpers.ts';

// Un tipo de nota se declara una vez, en tipos.ts. Estas pruebas fijan lo que esa declaración tiene que seguir
// diciendo y que lo que se declara en otros sitios, porque no se puede derivar, calce con ella.
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
    const porTipo = Object.fromEntries(TIPOS_DECLARADOS.map((tipo) => [tipo, [TIPOS_DE_NOTA[tipo].letra, config.carpetas[TIPOS_DE_NOTA[tipo].claveCarpeta]]]));
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
    assert.deepEqual(TIPOS_DECLARADOS.map((tipo) => TIPOS_DE_NOTA[tipo].claveCarpeta).sort(), Object.keys(config.carpetas).sort());
  });

  test('los tipos que se numeran son todos menos el release, y su id sale de la letra declarada', () => {
    assert.deepEqual([...TIPOS_NUMERADOS].sort(), ['decision', 'funcionalidad', 'guia', 'incidencia', 'tarea']);
    assert.equal(TIPOS_DE_NOTA.release.numerado, false);
    const esperados = { tarea: 'DEM-T-0007', funcionalidad: 'DEM-F-0007', incidencia: 'DEM-I-0007', decision: 'DEM-ADR-0007', guia: 'DEM-G-0007' };
    for (const tipo of TIPOS_NUMERADOS) assert.equal(formatearId('DEM', tipo, 7), esperados[tipo], tipo);
  });

  test('el id del release lleva la letra declarada y la versión', () => {
    assert.equal(idDeRelease('DEM', '1.2.3'), 'DEM-R-v1.2.3');
    assert.match('DEM-R-v1.2.3', PATRON_ID_RELEASE);
    assert.equal(idValido('DEM-R-v1.2.3', 'release', 'DEM'), true);
    assert.equal(idValido('DEM-X-v1.2.3', 'release', 'DEM'), false);
  });

  test('las letras no se repiten', () => {
    const letras = TIPOS_DECLARADOS.map((tipo) => TIPOS_DE_NOTA[tipo].letra);
    assert.equal(new Set(letras).size, letras.length);
  });

  test('las listas de dominio.ts, que no se derivan, calzan con la declaración', () => {
    for (const tipo of TIPOS_DECLARADOS) assert.ok((TIPOS as readonly string[]).includes(tipo), `TIPOS no trae «${tipo}»`);
    assert.deepEqual([...TIPOS_ITEM], TIPOS_DECLARADOS, 'TIPOS_ITEM tiene los mismos tipos, en el mismo orden');
  });

  test('cargarPlantilla acepta la plantilla que trae el MCP para cada tipo', async () => {
    for (const tipo of TIPOS_DECLARADOS) await assert.doesNotReject(cargarPlantilla(tipo), tipo);
  });

  test('una plantilla propia sin lo que el contrato exige se rechaza diciendo qué le falta, tipo por tipo', async () => {
    const propias = path.join(esc.base, 'plantillas-propias');
    await mkdir(propias);
    const faltan: Record<TipoDeNota, string> = {
      tarea: 'descripcion, criterios, historial',
      funcionalidad: 'que_hace, afirmaciones, pendientes, historial',
      incidencia: 'sintoma, impacto, causa, historial',
      decision: 'contexto, decision, alternativas, consecuencias',
      release: 'release',
      guia: 'proposito, pasos, problemas, afirmaciones, pendientes, historial',
    };
    for (const tipo of TIPOS_DECLARADOS) {
      await writeFile(path.join(propias, `${tipo}.md`), 'Sin campos ni bloques.\n', 'utf8');
      await assert.rejects(cargarPlantilla(tipo, propias), (error: unknown) => {
        assert.ok(error instanceof ErrorMcp, tipo);
        assert.equal(error.codigo, 'PLANTILLA_INVALIDA', tipo);
        assert.ok(error.message.includes(`faltan [${faltan[tipo]}]`), `${tipo}: ${error.message}`);
        return true;
      });
    }
  });
});
