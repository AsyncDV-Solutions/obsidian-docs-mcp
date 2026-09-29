import type { Config } from '../src/config.ts';
import { crearSesion } from '../src/sesion.ts';
import type { OpcionesSesion, Sesion } from '../src/sesion.ts';

// Una sesión nueva sobre el mismo vault con la configuración cambiada, con su propio almacén y su propio tope.
// Copiar una sesión con un spread compartiría el almacén de la original y dejaría su índice leyendo la
// configuración anterior: por eso las pruebas que cambian la configuración pasan por aquí.
export function conConfig(sesion: Sesion, cambiar: (config: Config) => Config, opciones?: OpcionesSesion): Sesion {
  return crearSesion({ ...sesion, config: cambiar(sesion.config) }, opciones);
}
