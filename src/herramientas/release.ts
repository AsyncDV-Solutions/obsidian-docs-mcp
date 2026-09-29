import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { ok } from '../errores.ts';
import { PATRON_SHA } from '../fuentes.ts';
import { indexar } from '../notas.ts';
import { comandosTag, listaVerificacion, prepararBorradorRelease, proponer } from '../release.ts';
import { ejecutar, respuestaPreparada, SOLO_LECTURA, UNA_LINEA, VERSION_NOTA } from './comun.ts';
import type { Entorno } from './comun.ts';

const LISTA = z.array(z.string().min(1).max(500).regex(UNA_LINEA)).max(50).optional();

export function registrarRelease(server: McpServer, entorno: Entorno): void {
  const v = entorno.vocabulario;
  server.registerTool(
    'release_proponer',
    {
      description: `Propone la versión y el tag de ${v.nombre} a partir de git (commits, migraciones y tags). SOLO TEXTO: no crea tags ni cambia nada.`,
      inputSchema: z.object({ head: z.string().max(100).optional().describe('Rama o commit a analizar; por defecto, la rama principal configurada') }),
      annotations: SOLO_LECTURA,
    },
    async (args) =>
      ejecutar('release_proponer', async () => {
        const { ctx } = entorno.exigir();
        const head = args.head ?? ctx.config.release.rama_principal;
        const p = await proponer(ctx, head);
        const corto = p.head.slice(0, 7);
        const c = p.clasificacion;
        const d = p.divergencia;
        return ok(
          [
            'Propuesta (solo texto: el MCP no crea tags).',
            `- Base: ${p.base ?? 'ninguna (no hay tags)'} · Head: ${head} = ${corto}`,
            `- Bump sugerido: ${p.bump} → v${p.version}`,
            c === null ? '' : `- Commits: major ${c.major.length} · minor ${c.minor.length} · patch ${c.patch.length} · otros ${c.otros.length} · no convencionales ${c.noConvencionales.length}`,
            d === null
              ? ''
              : `- Divergencia: ${d.principal} tiene ${d.principalNoEnDesarrollo} commit(s) que no están en ${d.desarrollo}; ${d.desarrollo} tiene ${d.desarrolloNoEnPrincipal} que no están en ${d.principal}.`,
            ...p.avisos.map((aviso) => `  ⚠️ ${aviso}`),
            'Señales para revisar:',
            ...(p.motivos.length === 0 ? ['- (ninguna)'] : p.motivos.map((m) => `- ${m}`)),
            'Lista de verificación antes del tag:',
            ...listaVerificacion(ctx, corto),
            'Comandos (los ejecutas tú, después de verificar):',
            ...comandosTag(ctx, p.version, corto),
          ]
            .filter((l) => l !== '')
            .join('\n'),
        );
      }),
  );

  server.registerTool(
    'release_borrador_guardar',
    {
      description:
        'PREPARA la creación o actualización de la nota de release (no escribe). Al actualizar, exige version_esperada y solo cambia las propiedades y el bloque gestionado; lo que escribiste fuera del bloque no se toca.',
      inputSchema: z.object({
        version: z.string().regex(/^\d+\.\d+\.\d+$/),
        titulo: z.string().min(3).max(200).regex(UNA_LINEA),
        resumen: z.string().min(1),
        anadido: LISTA,
        cambiado: LISTA,
        obsoleto: LISTA,
        eliminado: LISTA,
        corregido: LISTA,
        seguridad: LISTA,
        migraciones: LISTA,
        bump: z.enum(['major', 'minor', 'patch', 'linea-base']),
        base_ref: z.string().regex(/^(ninguno|v\d+\.\d+\.\d+)$/),
        head_ref: z.string().regex(PATRON_SHA),
        release_status: z.enum(['Borrador', 'Lista', 'Publicada']).default('Borrador'),
        promotion_run: z.string().regex(/^\d{1,20}$/).optional().describe('Id del run de CI que publicó el release (opcional); lo aportas tú'),
        fuentes: z.array(z.string().min(3).max(300).regex(UNA_LINEA)).max(20).default([]),
        version_esperada: VERSION_NOTA.optional(),
      }),
      annotations: SOLO_LECTURA,
    },
    async (args) =>
      ejecutar('release_borrador_guardar', async () => {
        const { ctx, guardia } = entorno.exigir();
        const datos = {
          ...args,
          secciones: { anadido: args.anadido, cambiado: args.cambiado, obsoleto: args.obsoleto, eliminado: args.eliminado, corregido: args.corregido, seguridad: args.seguridad },
          migraciones: args.migraciones ?? [],
        };
        return respuestaPreparada(await prepararBorradorRelease(ctx, guardia, await indexar(guardia, ctx.config), datos));
      }),
  );
}
