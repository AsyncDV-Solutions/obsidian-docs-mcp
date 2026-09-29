import type { McpServer } from '@modelcontextprotocol/server';
import { ok } from '../errores.ts';
import { notasDesactualizadas } from '../mantenimiento.ts';
import { AVISO_DATOS, ejecutar, SOLO_LECTURA } from './comun.ts';
import type { Entorno } from './comun.ts';

export function registrarMantenimiento(server: McpServer, entorno: Entorno): void {
  server.registerTool(
    'notas_desactualizadas',
    {
      description:
        'Lista las notas cuyas fuentes del repo (repo:<ruta>@<sha> o doc:<ruta>#sección@<sha>) cambiaron después del SHA revisado. Solo lectura: recomienda qué revisar.',
      annotations: SOLO_LECTURA,
    },
    async () =>
      ejecutar('notas_desactualizadas', async () => {
        const sesion = entorno.exigir();
        const r = await notasDesactualizadas(sesion);
        const lineas = [`Fuentes revisadas: ${r.revisadas} · omitidas: ${r.omitidas} (por formato, exclusión, tope o SHA ausente en tu clon).`];
        if (r.desactualizadas.length === 0) {
          lineas.push('Ninguna nota quedó atrás.');
        } else {
          lineas.push(AVISO_DATOS, 'Notas para revisar (una por una, con vista previa):', ...r.desactualizadas.map((d) => `- ${d.id}: ${d.fuente} → cambió en ${d.commit}`));
        }
        return ok(lineas.join('\n'));
      }),
  );
}
