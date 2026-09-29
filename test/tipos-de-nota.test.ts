import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { validarArranque } from '../src/arranque.ts';
import { prepararAdr, prepararFuncionalidad, prepararGuia, prepararIncidencia } from '../src/documentos.ts';
import { prepararBorradorRelease } from '../src/release.ts';
import { crearSesion } from '../src/sesion.ts';
import type { Sesion } from '../src/sesion.ts';
import { prepararTareaNueva } from '../src/tareas.ts';
import { consultasGitFalsas } from './consultas-git-falsas.ts';
import { crearEscenario, escribirNota, notaContadores } from './helpers.ts';
import type { Escenario } from './helpers.ts';

// Cada tipo de nota nace en su carpeta, con su id y con sus propiedades en este orden: lo que ve la persona en
// Obsidian y lo que el índice espera. Es la interfaz de crear, y fija que declarar los tipos una sola vez no la cambia.
const ENCABEZADO = ['id', 'project_id', 'type', 'schema', 'title'];
const FECHAS = ['created', 'updated'];
const CON_EVIDENCIA = ['key', 'area', 'evidence', 'reviewed_commit', 'reviewed_on', 'source', 'related'];

type Caso = { tipo: string; ruta: string; id: string; propiedades: string[]; preparar: (sesion: Sesion) => Promise<{ vistaPrevia: string }> };

const casos: Caso[] = [
  {
    tipo: 'tarea',
    ruta: 'Tareas/DEM-T-0001-encender-el-correo.md',
    id: 'DEM-T-0001',
    propiedades: ['status', 'priority', 'area', 'blocked_by', 'related', 'source'],
    preparar: async (sesion) => {
      const p = await prepararTareaNueva(sesion, { titulo: 'Encender el correo', descripcion: 'd', criterios: ['c'], prioridad: 'P1', estado_inicial: 'Por hacer', pedido_por: 'Ana' });
      return 'repetida' in p ? assert.fail('no puede salir repetida') : p;
    },
  },
  {
    tipo: 'funcionalidad',
    ruta: 'Funcionalidades/DEM-F-0001-cotizaciones.md',
    id: 'DEM-F-0001',
    propiedades: CON_EVIDENCIA,
    preparar: (sesion) =>
      prepararFuncionalidad(sesion, {
        key: 'modulo:quotes',
        titulo: 'Cotizaciones',
        que_hace: 'Arma cotizaciones.',
        afirmaciones: [{ afirmacion: 'Existe el módulo', evidencia: 'verificado-en-codigo', fuente: 'src/modules.ts' }],
        evidence: 'verificado-en-codigo',
        reviewed_commit: '8b4660d',
        fuentes: ['repo:src/modules.ts@8b4660d'],
      }),
  },
  {
    tipo: 'guia',
    ruta: 'Guias/DEM-G-0001-primeros-pasos.md',
    id: 'DEM-G-0001',
    propiedades: CON_EVIDENCIA,
    preparar: (sesion) =>
      prepararGuia(sesion, {
        key: 'guia:primeros-pasos',
        titulo: 'Primeros pasos',
        proposito: 'Orienta.',
        pasos: '1. Abre el admin.',
        afirmaciones: [{ afirmacion: 'El admin vive en /admin', evidencia: 'solo-documentacion', fuente: 'repo:docs/a.md@8b4660d' }],
        evidence: 'solo-documentacion',
        reviewed_commit: '8b4660d',
        fuentes: ['repo:docs/a.md@8b4660d'],
      }),
  },
  {
    tipo: 'decision',
    ruta: 'Decisiones/DEM-ADR-0001-suspension-con-gracia.md',
    id: 'DEM-ADR-0001',
    propiedades: ['decision_status', 'deciders', 'supersedes', 'area', 'evidence', 'source', 'related'],
    preparar: (sesion) =>
      prepararAdr(sesion, {
        titulo: 'Suspensión con gracia',
        contexto: 'c',
        decision: 'd',
        alternativas: 'a',
        consecuencias: 'x',
        deciders: ['owner'],
        evidence: 'verificado-en-codigo',
        fuentes: ['commit:906b047'],
      }),
  },
  {
    tipo: 'incidencia',
    ruta: 'Incidencias/DEM-I-0001-falla.md',
    id: 'DEM-I-0001',
    propiedades: ['status', 'priority', 'severity', 'environment', 'detected', 'area', 'source', 'related'],
    preparar: (sesion) =>
      prepararIncidencia(sesion, {
        titulo: 'Falla',
        sintoma: 's',
        impacto: 'i',
        severity: 'alta',
        environment: 'produccion',
        detected: '2026-09-29',
        prioridad: 'P1',
        fuentes: ['repo:x.ts@abc1234'],
        pedido_por: 'Ana',
      }),
  },
  {
    tipo: 'release',
    ruta: 'Releases/DEM-R-v1.0.0.md',
    id: 'DEM-R-v1.0.0',
    propiedades: ['version', 'proposed_tag', 'release_status', 'bump', 'base_ref', 'head_ref', 'analyzed_on', 'tag_verified', 'source'],
    preparar: (sesion) =>
      prepararBorradorRelease(sesion, {
        version: '1.0.0',
        titulo: 'Primera',
        resumen: 'r',
        secciones: {},
        migraciones: [],
        bump: 'linea-base',
        base_ref: 'ninguno',
        head_ref: 'abc1234',
        release_status: 'Borrador',
        fuentes: [],
      }),
  },
];

describe('cada tipo de nota nace en su carpeta y con sus propiedades en su orden', () => {
  let esc: Escenario;
  let sesion: Sesion;

  beforeEach(async () => {
    esc = await crearEscenario();
    await escribirNota(esc.proyecto, '_contadores.md', notaContadores());
    for (const carpeta of ['Tareas', 'Funcionalidades', 'Decisiones', 'Incidencias', 'Releases', 'Guias']) await mkdir(path.join(esc.proyecto, carpeta));
    const estado = await validarArranque(['--config', esc.rutaConfig], {});
    assert.ok(estado.ok, 'el escenario debería arrancar');
    sesion = crearSesion({ ...estado.ctx, consultasGit: consultasGitFalsas({ existeTag: async () => false }) });
  });
  afterEach(async () => {
    await esc.limpiar();
  });

  for (const caso of casos) {
    test(caso.tipo, async () => {
      const { vistaPrevia } = await caso.preparar(sesion);
      const nota = /^Crear (\S+):\n———\n---\n([\s\S]*?)\n---\n/m.exec(vistaPrevia) ?? assert.fail('la vista previa no muestra una nota nueva');
      assert.equal(nota[1], caso.ruta);
      const claves = [...(nota[2] ?? '').matchAll(/^([a-z_]+):/gm)].map((m) => m[1]);
      assert.deepEqual(claves, [...ENCABEZADO, ...caso.propiedades, ...FECHAS]);
      assert.match(nota[2] ?? '', new RegExp(`^id: ${caso.id}$`, 'm'));
      assert.match(nota[2] ?? '', new RegExp(`^type: ${caso.tipo}$`, 'm'));
    });
  }
});
