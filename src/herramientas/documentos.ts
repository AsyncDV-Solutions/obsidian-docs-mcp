import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { Contexto } from '../arranque.ts';
import {
  prepararActualizacionFuncionalidad,
  prepararActualizacionGuia,
  prepararAdr,
  prepararFuncionalidad,
  prepararGuia,
  prepararIncidencia,
} from '../documentos.ts';
import { EVIDENCIAS, PRIORIDADES, SEVERIDADES } from '../dominio.ts';
import { ok } from '../errores.ts';
import { indexar } from '../notas.ts';
import { prepararTablero } from '../tablero.ts';
import { conPedidoPor, ejecutar, FECHA, ID, MOTIVO, PEDIDO_POR, PREPARA, RELEASE, respuestaPreparada, UNA_LINEA, VERSION_NOTA } from './comun.ts';
import type { Entorno, Vocabulario } from './comun.ts';

const FUENTE = z.string().min(3).max(300).regex(UNA_LINEA).describe('tipo:valor[@sha], p. ej. repo:src/pedidos/crear.ts@3e22c9c');
const SHA = z.string().regex(/^[0-9a-f]{7,40}$/);
const ID_FUNCIONALIDAD = z.string().regex(/^[A-Z]{2,5}-F-\d{4,}$/);
const ID_GUIA = z.string().regex(/^[A-Z]{2,5}-G-\d{4,}$/);
const TITULO = z.string().min(3).max(200).regex(UNA_LINEA);
const KEY = z.string().regex(/^[a-z]+:[a-z0-9._/-]+$/);
const AFIRMACIONES = z
  .array(z.object({ afirmacion: z.string().min(1).max(500).regex(UNA_LINEA), evidencia: z.enum(EVIDENCIAS), fuente: z.string().max(300).regex(UNA_LINEA) }))
  .min(1)
  .max(40);

const DESCRIPCION_ACTUALIZAR =
  'afirmaciones (reemplaza la tabla entera), evidence, reviewed_commit, fuentes (reemplaza la lista), área, relacionadas o pendientes. La key no cambia. Cambiar afirmaciones, fuentes o evidence exige reviewed_commit. Lee antes la nota con nota_leer: su versión va en version_esperada.';

// Campos comunes de funcionalidad_actualizar y guia_actualizar (el id y los textos propios van aparte).
function camposActualizacion(v: Vocabulario) {
  return {
    version_esperada: VERSION_NOTA,
    pedido_por: PEDIDO_POR,
    motivo: MOTIVO.optional().describe('Por qué se actualiza, p. ej. «crear.ts cambió en 3e22c9c»'),
    titulo: TITULO.optional(),
    afirmaciones: AFIRMACIONES.optional(),
    evidence: z.enum(EVIDENCIAS).optional().describe('Evidencia de la nota completa'),
    reviewed_commit: SHA.optional(),
    fuentes: z.array(FUENTE).min(1).max(20).optional(),
    area: z.array(z.enum(v.areas)).max(5).optional(),
    relacionadas: z.array(ID).max(20).optional(),
    pendientes: z.array(ID).max(20).optional(),
  };
}

export function registrarDocumentos(server: McpServer, entorno: Entorno): void {
  const v = entorno.vocabulario;
  server.registerTool(
    'funcionalidad_crear',
    {
      description: 'PREPARA una nota de funcionalidad (no escribe). La key es única (p. ej. modulo:pedidos); evidence, reviewed_commit y fuentes son obligatorias.',
      inputSchema: z.object({
        key: KEY.describe('Clave natural única: modulo:pedidos, api:crear-pedido, workflow:deploy, agente:revisor…'),
        titulo: TITULO,
        que_hace: z.string().min(1),
        afirmaciones: AFIRMACIONES,
        evidence: z.enum(EVIDENCIAS).describe('Evidencia de la nota completa'),
        reviewed_commit: SHA,
        fuentes: z.array(FUENTE).min(1).max(20),
        area: z.array(z.enum(v.areas)).max(5).optional(),
        relacionadas: z.array(ID).max(20).optional(),
        pendientes: z.array(ID).max(20).optional(),
      }),
      annotations: PREPARA,
    },
    async (args) =>
      ejecutar('funcionalidad_crear', async () => {
        const { ctx, guardia } = entorno.exigir();
        return respuestaPreparada(await prepararFuncionalidad(ctx, guardia, await indexar(guardia, ctx.config), args));
      }),
  );

  // Versión 1.2.0
  server.registerTool(
    'funcionalidad_actualizar',
    {
      description: `PREPARA cambios en una funcionalidad existente (no escribe): título, qué hace, ${DESCRIPCION_ACTUALIZAR}`,
      inputSchema: z.object({
        id: ID_FUNCIONALIDAD,
        ...camposActualizacion(v),
        que_hace: z.string().min(1).optional(),
      }),
      annotations: PREPARA,
    },
    async (args) =>
      ejecutar('funcionalidad_actualizar', async () => {
        const { ctx, guardia } = entorno.exigir();
        return respuestaPreparada(await prepararActualizacionFuncionalidad(ctx, guardia, await indexar(guardia, ctx.config), conPedidoPor(ctx, args)));
      }),
  );

  server.registerTool(
    'guia_crear',
    {
      description:
        'PREPARA una guía de uso (no escribe): cómo se usa algo que ya existe, paso a paso. La key es única junto con las de funcionalidades (p. ej. guia:primeros-pasos); evidence, reviewed_commit y fuentes son obligatorias.',
      inputSchema: z.object({
        key: KEY.describe('Clave natural única: guia:primeros-pasos, guia:mapa-workflows, guia:publicar-cambios…'),
        titulo: TITULO,
        proposito: z.string().min(1).describe('Para qué sirve y a quién le sirve'),
        pasos: z.string().min(1).describe('Cómo se usa: pasos numerados en Markdown, con requisitos previos si los hay'),
        problemas: z.string().optional().describe('Problemas frecuentes y qué hacer'),
        afirmaciones: AFIRMACIONES,
        evidence: z.enum(EVIDENCIAS).describe('Evidencia de la nota completa'),
        reviewed_commit: SHA,
        fuentes: z.array(FUENTE).min(1).max(20),
        area: z.array(z.enum(v.areas)).max(5).optional(),
        relacionadas: z.array(ID).max(20).optional(),
        pendientes: z.array(ID).max(20).optional(),
      }),
      annotations: PREPARA,
    },
    async (args) =>
      ejecutar('guia_crear', async () => {
        const { ctx, guardia } = entorno.exigir();
        return respuestaPreparada(await prepararGuia(ctx, guardia, await indexar(guardia, ctx.config), args));
      }),
  );

  // Versión 2.1.0
  server.registerTool(
    'guia_actualizar',
    {
      description: `PREPARA cambios en una guía existente (no escribe): título, propósito, pasos, problemas frecuentes, ${DESCRIPCION_ACTUALIZAR}`,
      inputSchema: z.object({
        id: ID_GUIA,
        ...camposActualizacion(v),
        proposito: z.string().min(1).optional().describe('Para qué sirve y a quién le sirve'),
        pasos: z.string().min(1).optional().describe('Cómo se usa: pasos numerados en Markdown'),
        problemas: z.string().optional().describe('Problemas frecuentes y qué hacer. Vacío deja «(ninguno registrado)»'),
      }),
      annotations: PREPARA,
    },
    async (args) =>
      ejecutar('guia_actualizar', async () => {
        const { ctx, guardia } = entorno.exigir();
        return respuestaPreparada(await prepararActualizacionGuia(ctx, guardia, await indexar(guardia, ctx.config), conPedidoPor(ctx, args)));
      }),
  );

  server.registerTool(
    'adr_crear',
    {
      description: 'PREPARA una decisión arquitectónica (ADR) en estado «Propuesta» (no escribe).',
      inputSchema: z.object({
        titulo: TITULO,
        contexto: z.string().min(1),
        decision: z.string().min(1),
        alternativas: z.string().min(1),
        consecuencias: z.string().min(1),
        deciders: z.array(z.string().min(1).max(80).regex(UNA_LINEA)).min(1).max(10),
        evidence: z.enum(EVIDENCIAS),
        fuentes: z.array(FUENTE).min(1).max(20),
        area: z.array(z.enum(v.areas)).max(5).optional(),
        supersedes: z.array(ID).max(10).optional(),
        relacionadas: z.array(ID).max(20).optional(),
      }),
      annotations: PREPARA,
    },
    async (args) =>
      ejecutar('adr_crear', async () => {
        const { ctx, guardia } = entorno.exigir();
        return respuestaPreparada(await prepararAdr(ctx, guardia, await indexar(guardia, ctx.config), args));
      }),
  );

  server.registerTool(
    'incidencia_crear',
    {
      description: 'PREPARA una incidencia o un bloqueo (no escribe). Severidad y ambiente son obligatorios; nace en «Por hacer».',
      inputSchema: z.object({
        titulo: TITULO,
        sintoma: z.string().min(1),
        impacto: z.string().min(1),
        causa: z.string().optional(),
        severity: z.enum(SEVERIDADES),
        environment: z.enum(v.ambientes),
        detected: FECHA,
        prioridad: z.enum(PRIORIDADES),
        area: z.array(z.enum(v.areas)).max(5).optional(),
        release: RELEASE.optional(),
        fuentes: z.array(FUENTE).min(1).max(20),
        relacionadas: z.array(ID).max(20).optional(),
        pedido_por: PEDIDO_POR,
      }),
      annotations: PREPARA,
    },
    async (args) =>
      ejecutar('incidencia_crear', async () => {
        const { ctx, guardia } = entorno.exigir();
        return respuestaPreparada(await prepararIncidencia(ctx, guardia, await indexar(guardia, ctx.config), conPedidoPor(ctx, args)));
      }),
  );

  server.registerTool(
    'tablero_regenerar',
    {
      description: 'PREPARA la regeneración del bloque del tablero en Tablero.md (no escribe). Si el tablero ya está al día, no prepara nada.',
      annotations: PREPARA,
    },
    async () =>
      ejecutar('tablero_regenerar', async () => {
        const { ctx, guardia } = entorno.exigir();
        const preparado = await prepararTablero(ctx, guardia, await indexar(guardia, ctx.config));
        return preparado === null ? ok('El tablero ya está al día: no hay nada que cambiar.') : respuestaPreparada(preparado);
      }),
  );
}
