import { McpServer } from '@modelcontextprotocol/server';
import type { EstadoArranque } from './arranque.ts';
import { AMBIENTES_POR_DEFECTO, AREAS_POR_DEFECTO, CATEGORIAS_POR_DEFECTO, nombreProyecto } from './config.ts';
import { ErrorMcp } from './errores.ts';
import { crearGuardia } from './guardia.ts';
import type { Entorno, Vocabulario } from './herramientas/comun.ts';
import { registrarConsulta } from './herramientas/consulta.ts';
import { registrarDocumentos } from './herramientas/documentos.ts';
import { registrarMantenimiento } from './herramientas/mantenimiento.ts';
import { registrarRelease } from './herramientas/release.ts';
import { registrarRepo } from './herramientas/repo.ts';
import { registrarTareas } from './herramientas/tareas.ts';
import { NOMBRE, VERSION } from './version.ts';

// z.enum exige al menos una opción: la configuración ya lo garantiza; el respaldo cubre un arranque fallido.
function noVacia(valores: string[], respaldo: string[]): [string, ...string[]] {
  const [primero, ...resto] = valores.length > 0 ? valores : respaldo;
  return [primero ?? 'ninguna', ...resto];
}

// Con la configuración rota, las herramientas quedan bloqueadas igual: el vocabulario por defecto solo
// sirve para que se puedan listar.
function vocabularioDe(estado: EstadoArranque): Vocabulario {
  const cfg = estado.ok ? estado.ctx.config : null;
  const categorias = CATEGORIAS_POR_DEFECTO.map((c) => c.clave);
  return {
    nombre: cfg === null ? 'el proyecto' : nombreProyecto(cfg),
    prefijo: cfg?.id_prefix ?? 'PRJ',
    areas: noVacia(cfg?.areas ?? [], AREAS_POR_DEFECTO),
    ambientes: noVacia(cfg?.ambientes ?? [], AMBIENTES_POR_DEFECTO),
    categorias: noVacia(cfg?.repo.categorias.map((c) => c.clave) ?? [], categorias),
  };
}

export function crearServidor(estado: EstadoArranque): McpServer {
  const guardia = estado.ok ? crearGuardia(estado.ctx.proyecto, estado.ctx.config.limites) : null;
  const entorno: Entorno = {
    estado,
    vocabulario: vocabularioDe(estado),
    exigir() {
      if (!estado.ok || guardia === null) {
        throw new ErrorMcp('BLOQUEADO', 'La configuración tiene problemas: usa proyecto_estado para ver cuáles.');
      }
      return { ctx: estado.ctx, guardia };
    },
  };

  const server = new McpServer({ name: NOMBRE, version: VERSION });
  registrarConsulta(server, entorno);
  registrarTareas(server, entorno);
  registrarDocumentos(server, entorno);
  registrarRepo(server, entorno);
  registrarRelease(server, entorno);
  registrarMantenimiento(server, entorno);
  return server;
}
