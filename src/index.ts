import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { permisosDeNodeActivos, validarArranque } from './arranque.ts';
import { activarLogArchivo, registrar } from './log.ts';
import { crearServidor } from './servidor.ts';
import { NOMBRE, VERSION } from './version.ts';

const estado = await validarArranque(process.argv.slice(2));
if (estado.ok) activarLogArchivo(estado.ctx.dirEstado);
registrar('permisos', { activos: permisosDeNodeActivos() });
registrar('arranque', {
  servidor: NOMBRE,
  version: VERSION,
  ok: estado.ok,
  problemas: estado.ok ? '' : estado.problemas.map((p) => p.codigo).join(','),
});

void serveStdio(() => crearServidor(estado));
