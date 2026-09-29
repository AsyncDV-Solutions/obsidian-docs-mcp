import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { aplicarCambio } from '../aplicar.ts';
import { ESTADOS, PRIORIDADES, RESOLUCIONES } from '../dominio.ts';
import { ok } from '../errores.ts';
import { fuenteRepo } from '../fuentes.ts';
import { indexar } from '../notas.ts';
import { prepararActualizacion, prepararCambioEstado, prepararTareaNueva } from '../tareas.ts';
import { conPedidoPor, ejecutar, FECHA, ID, ID_TAREA, MOTIVO, PEDIDO_POR, PREPARA, RELEASE, respuestaPreparada, UNA_LINEA, VERSION_NOTA } from './comun.ts';
import type { Entorno } from './comun.ts';

export function registrarTareas(server: McpServer, entorno: Entorno): void {
  const v = entorno.vocabulario;
  server.registerTool(
    'tarea_crear',
    {
      description:
        'PREPARA la creación de una tarea: no escribe nada. Devuelve una vista previa y un código para cambio_aplicar. Si ya hay una tarea abierta con el mismo título, la devuelve en vez de duplicarla.',
      inputSchema: z.object({
        titulo: z.string().min(3).max(200).regex(UNA_LINEA),
        descripcion: z.string().min(1),
        criterios: z.array(z.string().min(1).max(500).regex(UNA_LINEA)).min(1).max(30).describe('Criterios de aceptación (al menos uno)'),
        prioridad: z.enum(PRIORIDADES),
        area: z.array(z.enum(v.areas)).max(5).optional(),
        responsable: z.string().max(80).regex(UNA_LINEA).optional(),
        due: FECHA.optional(),
        release: RELEASE.optional(),
        blocked_by: z.array(ID).max(20).optional().describe('Dependencias: ids de tareas o incidencias'),
        relacionadas: z.array(ID).max(20).optional(),
        fuentes: z.array(z.string().max(300).regex(UNA_LINEA)).max(20).optional().describe(`tipo:valor[@sha], p. ej. ${fuenteRepo('src/x.ts', 'abc1234')}`),
        estado_inicial: z.enum(['Por hacer', 'Pendiente']).default('Por hacer'),
        motivo: MOTIVO.optional(),
        pedido_por: PEDIDO_POR,
      }),
      annotations: PREPARA,
    },
    async (args) =>
      ejecutar('tarea_crear', async () => {
        const { ctx, guardia } = entorno.exigir();
        const preparado = await prepararTareaNueva(ctx, guardia, await indexar(guardia, ctx.config), conPedidoPor(ctx, args));
        if ('repetida' in preparado) {
          const { id, datos, ruta } = preparado.repetida;
          return ok(`Ya existe ${id} (${String(datos.status)}) con ese título: ${ruta}. No se preparó nada.`);
        }
        return respuestaPreparada(preparado);
      }),
  );

  server.registerTool(
    'tarea_cambiar_estado',
    {
      description:
        'PREPARA un cambio de estado de una tarea o incidencia (no escribe). Bloqueado exige blocked_by o blocked_reason; Pendiente y reabrir exigen motivo; Completado exige resolution (hecha, cancelada o duplicada).',
      inputSchema: z.object({
        id: ID_TAREA,
        estado: z.enum(ESTADOS),
        version_esperada: VERSION_NOTA,
        pedido_por: PEDIDO_POR,
        motivo: MOTIVO.optional(),
        resolution: z.enum(RESOLUCIONES).optional(),
        blocked_by: z.array(ID).max(20).optional(),
        blocked_reason: MOTIVO.optional(),
      }),
      annotations: PREPARA,
    },
    async (args) =>
      ejecutar('tarea_cambiar_estado', async () => {
        const { ctx, guardia } = entorno.exigir();
        const preparado = await prepararCambioEstado(ctx, guardia, await indexar(guardia, ctx.config), conPedidoPor(ctx, args));
        if (preparado === null) return ok(`${args.id} ya está en «${args.estado}»: no hay nada que cambiar.`);
        return respuestaPreparada(preparado);
      }),
  );

  server.registerTool(
    'tarea_actualizar',
    {
      description:
        'PREPARA cambios en campos de una tarea o incidencia (no escribe): prioridad, responsable, due, release, área, blocked_by, blocked_reason, relacionadas o un criterio nuevo. null quita el campo.',
      inputSchema: z.object({
        id: ID_TAREA,
        version_esperada: VERSION_NOTA,
        pedido_por: PEDIDO_POR,
        prioridad: z.enum(PRIORIDADES).optional(),
        responsable: z.string().max(80).regex(UNA_LINEA).nullable().optional(),
        due: FECHA.nullable().optional(),
        release: RELEASE.nullable().optional(),
        area: z.array(z.enum(v.areas)).max(5).optional(),
        blocked_by: z.array(ID).max(20).optional(),
        blocked_reason: MOTIVO.nullable().optional(),
        relacionadas: z.array(ID).max(20).optional(),
        criterio_nuevo: z.string().min(1).max(500).regex(UNA_LINEA).optional(),
      }),
      annotations: PREPARA,
    },
    async (args) =>
      ejecutar('tarea_actualizar', async () => {
        const { ctx, guardia } = entorno.exigir();
        return respuestaPreparada(await prepararActualizacion(ctx, guardia, await indexar(guardia, ctx.config), conPedidoPor(ctx, args)));
      }),
  );

  server.registerTool(
    'cambio_aplicar',
    {
      description:
        'APLICA un cambio preparado antes (crear o editar notas). Úsala solo después de mostrar la vista previa y con la aprobación explícita de la persona. El código vale una sola vez y vence.',
      inputSchema: z.object({ confirmacion: z.string().min(16).max(64) }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ confirmacion }) =>
      ejecutar('cambio_aplicar', async () => {
        const { ctx, guardia } = entorno.exigir();
        const hechas = await aplicarCambio(ctx, guardia, confirmacion);
        return ok(['Aplicado:', ...hechas.map((h) => `- ${h}`)].join('\n'));
      }),
  );
}
