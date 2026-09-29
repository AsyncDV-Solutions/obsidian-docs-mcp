import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { permisosDeNodeActivos } from '../arranque.ts';
import { ESTADOS, PRIORIDADES, TIPOS, TIPOS_ITEM } from '../dominio.ts';
import { ok } from '../errores.ts';
import { formatearId, idDeRelease } from '../ids.ts';
import { buscar, conteoDeNotas, estadoDe, filtrar, leerNota, ordenPorPrioridad } from '../notas.ts';
import { NOMBRE, VERSION } from '../version.ts';
import { AVISO_DATOS, ejecutar, SOLO_LECTURA } from './comun.ts';
import type { Entorno } from './comun.ts';

const SalidaEstado = z.object({
  servidor: z.string(),
  version: z.string(),
  node: z.string(),
  permisos_node: z.enum(['activos', 'inactivos']),
  configuracion: z.enum(['ok', 'con_problemas']),
  problemas: z.array(z.object({ codigo: z.string(), mensaje: z.string() })),
  conteos: z.record(z.string(), z.number()),
  anomalias: z.array(z.object({ ruta: z.string(), problema: z.string() })),
  truncado: z.boolean(),
});

const Item = z.object({
  id: z.string(),
  titulo: z.string(),
  tipo: z.string(),
  estado: z.string(),
  prioridad: z.string(),
  ruta: z.string(),
});

export function registrarConsulta(server: McpServer, entorno: Entorno): void {
  const v = entorno.vocabulario;
  server.registerTool(
    'proyecto_estado',
    {
      description:
        'Diagnóstico del proyecto: configuración, marcador, conteos por tipo y estado, y anomalías (notas sin project_id o con uno ajeno, YAML inválido, IDs repetidos). Úsala primero si algo falla.',
      outputSchema: SalidaEstado,
      annotations: SOLO_LECTURA,
    },
    async () =>
      ejecutar('proyecto_estado', async () => {
        const permisos = permisosDeNodeActivos() ? ('activos' as const) : ('inactivos' as const);
        const base = { servidor: NOMBRE, version: VERSION, node: process.version, permisos_node: permisos };
        if (!entorno.estado.ok) {
          const problemas = entorno.estado.problemas;
          const texto = ['Configuración con problemas. Las herramientas de notas están bloqueadas:', ...problemas.map((p) => `- [${p.codigo}] ${p.mensaje}`)].join('\n');
          return {
            ...ok(texto),
            structuredContent: { ...base, configuracion: 'con_problemas', problemas, conteos: {}, anomalias: [], truncado: false },
          };
        }
        const sesion = entorno.exigir();
        const indice = await sesion.indice();
        const conteos = conteoDeNotas(indice);
        const texto = [
          `${NOMBRE} ${VERSION} | Node ${process.version} | proyecto ${sesion.config.project_id}: configuración OK | permisos de Node: ${permisos}`,
          `Notas del proyecto: ${indice.notas.length}${indice.truncado ? ' (se alcanzó el tope: el índice está truncado)' : ''}.`,
          ...Object.entries(conteos).map(([clave, n]) => `- ${clave}: ${n}`),
          indice.anomalias.length === 0 ? 'Sin anomalías.' : `Anomalías (${indice.anomalias.length}); el MCP no las corrige:`,
          ...indice.anomalias.slice(0, 50).map((a) => `- ${a.ruta}: ${a.problema}`),
        ].join('\n');
        return {
          ...ok(texto),
          structuredContent: { ...base, configuracion: 'ok', problemas: [], conteos, anomalias: indice.anomalias, truncado: indice.truncado },
        };
      }),
  );

  server.registerTool(
    'notas_buscar',
    {
      description: 'Busca texto en el título y el cuerpo de las notas del proyecto, sin distinguir mayúsculas ni tildes. Admite filtros y devuelve fragmentos cortos.',
      inputSchema: z.object({
        texto: z.string().min(2).max(200).describe('Texto a buscar'),
        tipo: z.enum(TIPOS).optional(),
        estado: z.enum(ESTADOS).optional(),
        area: z.enum(v.areas).optional(),
      }),
      annotations: SOLO_LECTURA,
    },
    async ({ texto, tipo, estado, area }) =>
      ejecutar('notas_buscar', async () => {
        const sesion = entorno.exigir();
        const indice = await sesion.indice();
        const hallazgos = buscar(indice, texto, { tipo, estado, area }, sesion.config.limites.resultados_max);
        if (hallazgos.length === 0) return ok('Sin resultados.');
        const lineas = hallazgos.map((h) => `- ${h.id || '(sin id)'} · ${h.titulo} · ${h.ruta}${h.fragmento ? `\n  «…${h.fragmento}…»` : ''}`);
        return ok([AVISO_DATOS, `${hallazgos.length} resultado(s):`, ...lineas].join('\n'));
      }),
  );

  server.registerTool(
    'nota_leer',
    {
      description:
        `Lee una nota del proyecto por id (p. ej. ${formatearId(v.prefijo, 'tarea', 1)}) o por ruta relativa a la carpeta del proyecto. Devuelve su contenido y su versión; la versión se exige después para editarla.`,
      inputSchema: z.object({
        id: z.string().max(40).optional(),
        ruta: z.string().max(260).optional(),
      }),
      annotations: SOLO_LECTURA,
    },
    async ({ id, ruta }) =>
      ejecutar('nota_leer', async () => {
        const sesion = entorno.exigir();
        const leida = await leerNota(sesion, { id, ruta });
        return ok([`ruta: ${leida.ruta}`, `version: ${leida.version}`, AVISO_DATOS, '———', leida.texto].join('\n'));
      }),
  );

  server.registerTool(
    'items_listar',
    {
      description: 'Lista tareas, funcionalidades, incidencias, decisiones, releases o guías, con filtros por estado, prioridad, área, release, bloqueo y dependencia.',
      inputSchema: z.object({
        tipo: z.enum(TIPOS_ITEM),
        estado: z.enum(ESTADOS).optional(),
        prioridad: z.enum(PRIORIDADES).optional(),
        area: z.enum(v.areas).optional(),
        release: z.string().max(40).optional().describe(`Id del release, p. ej. ${idDeRelease(v.prefijo, '1.0.0')}`),
        bloqueadas: z.boolean().optional(),
        depende_de: z.string().max(40).optional().describe('Id que aparece en blocked_by'),
      }),
      outputSchema: z.object({ items: z.array(Item), total: z.number(), truncado: z.boolean() }),
      annotations: SOLO_LECTURA,
    },
    async (filtros) =>
      ejecutar('items_listar', async () => {
        const sesion = entorno.exigir();
        const indice = await sesion.indice();
        const todas = filtrar(indice, filtros).sort(ordenPorPrioridad);
        const items = todas.slice(0, sesion.config.limites.resultados_max).map((n) => ({
          id: n.id,
          titulo: n.titulo,
          tipo: n.tipo,
          estado: estadoDe(n),
          prioridad: String(n.datos.priority ?? ''),
          ruta: n.ruta,
        }));
        const texto = items.length === 0 ? 'Sin resultados.' : items.map((i) => `- ${i.id} · ${i.estado} · ${i.prioridad} · ${i.titulo}`).join('\n');
        return { ...ok(texto), structuredContent: { items, total: todas.length, truncado: todas.length > items.length } };
      }),
  );
}
