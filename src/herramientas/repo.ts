import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { ok } from '../errores.ts';
import { fuenteRepo } from '../fuentes.ts';
import { cuentaDeCommits, esDocHistorico, inventario, leerArchivoRepo, resumenGit, validarRelativaRepo } from '../repo.ts';
import { AVISO_DATOS, ejecutar, SOLO_LECTURA } from './comun.ts';
import type { Entorno } from './comun.ts';

const AVISO_CAMBIOS = ' (OJO: el archivo tiene cambios sin commitear; el contenido no es el de ese commit)';

export function registrarRepo(server: McpServer, entorno: Entorno): void {
  const v = entorno.vocabulario;
  server.registerTool(
    'repo_inventario',
    {
      description: `Lista (solo nombres) los archivos del repo de ${v.nombre} por categoría y marca los docs históricos. Solo ve las categorías configuradas; nunca muestra secretos ni archivos excluidos.`,
      inputSchema: z.object({ categoria: z.enum(v.categorias).optional() }),
      annotations: SOLO_LECTURA,
    },
    async ({ categoria }) =>
      ejecutar('repo_inventario', async () => {
        const { ctx } = entorno.exigir();
        const grupos = (await inventario(ctx)).filter((g) => categoria === undefined || g.categoria === categoria);
        const head = await ctx.consultasGit.cabezaCorta();
        const lineas = [`Repo de ${v.nombre} @ ${head} (clon local, sin fetch).`];
        for (const g of grupos) {
          lineas.push('', `${g.descripcion} (${g.rutas.length}):`, ...g.rutas.map((r) => `- ${r}${esDocHistorico(ctx, r) ? ' (histórico: preferir el código)' : ''}`));
        }
        return ok(lineas.join('\n'));
      }),
  );

  server.registerTool(
    'repo_archivo_leer',
    {
      description: `Lee un archivo del repo de ${v.nombre}, solo si su categoría permite leer contenido. Devuelve la fuente lista para citar: repo:<ruta>@<sha>.`,
      inputSchema: z.object({ ruta: z.string().min(1).max(260).describe('Relativa a la raíz del repo, p. ej. src/pedidos/crear.ts') }),
      annotations: SOLO_LECTURA,
    },
    async ({ ruta }) =>
      ejecutar('repo_archivo_leer', async () => {
        const { ctx } = entorno.exigir();
        const contenido = await leerArchivoRepo(ctx, ruta);
        const relativa = validarRelativaRepo(ruta);
        const head = await ctx.consultasGit.cabezaCorta();
        const conCambios = await ctx.consultasGit.archivoConCambios(relativa);
        return ok(
          [
            `fuente: ${fuenteRepo(relativa, head)}${conCambios ? AVISO_CAMBIOS : ''}`,
            AVISO_DATOS,
            '———',
            contenido,
          ].join('\n'),
        );
      }),
  );

  server.registerTool(
    'repo_git_resumen',
    {
      description: `Resumen git del repo de ${v.nombre}: rama, HEAD, cambios sin commitear, divergencia entre ramas (si está configurada), commits recientes y tags. No hace fetch.`,
      annotations: SOLO_LECTURA,
    },
    async () =>
      ejecutar('repo_git_resumen', async () => {
        const { ctx } = entorno.exigir();
        const r = await resumenGit(ctx);
        const d = r.divergencia;
        return ok(
          [
            `Rama actual: ${r.rama} · HEAD ${r.head.slice(0, 7)} · cambios sin commitear: ${r.cambios}`,
            ...(d === null
              ? ['Divergencia entre ramas: no configurada (release.rama_desarrollo).']
              : [
                  `Commits en ${d.principal} que no están en ${d.desarrollo}: ${cuentaDeCommits(d.principalNoEnDesarrollo)}`,
                  `Commits en ${d.desarrollo} que no están en ${d.principal}: ${cuentaDeCommits(d.desarrolloNoEnPrincipal)}`,
                ]),
            `Tags v*: ${r.tags.length === 0 ? '(ninguno)' : r.tags.join(', ')}`,
            'Son datos del clon local: el MCP no hace fetch. Para datos frescos, haz tú git fetch.',
            AVISO_DATOS,
            'Commits recientes:',
            ...r.recientes.map((c) => `- ${c}`),
          ].join('\n'),
        );
      }),
  );
}
