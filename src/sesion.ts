// La sesión: lo que el servidor necesita mientras corre. Suma al contexto del arranque, que son hechos ya validados
// (configuración, rutas, guardia, git), lo que tiene estado: el almacén de cambios preparados, el tope de
// escrituras, el reloj y el escritor. Cada preparador y aplicar reciben la sesión y no vuelven a armar nada, y una
// prueba crea la suya con un reloj o un escritor de mentira.
import { crearAlmacen, crearTope } from './almacen.ts';
import type { Almacen, Reloj, Tope } from './almacen.ts';
import type { Contexto } from './arranque.ts';
import { escritorReal } from './escritura.ts';
import type { Escritor } from './escritura.ts';
import { indexar } from './notas.ts';
import type { Indice } from './notas.ts';

export type Sesion = Contexto & {
  almacen: Almacen; // los cambios preparados que esperan su código de confirmación
  tope: Tope; // cuántas escrituras se aceptan por minuto
  reloj: Reloj;
  escritor: Escritor; // lo único que toca el disco al aplicar un cambio
  indice(): Promise<Indice>; // lee el vault en el momento: nunca devuelve algo recordado
};

export type OpcionesSesion = { reloj?: Reloj; escritor?: Escritor };

export function crearSesion(ctx: Contexto, opciones: OpcionesSesion = {}): Sesion {
  const reloj = opciones.reloj ?? Date.now;
  return {
    ...ctx,
    almacen: crearAlmacen(reloj),
    tope: crearTope(reloj, ctx.config.limites.escrituras_por_minuto),
    reloj,
    escritor: opciones.escritor ?? escritorReal,
    indice: () => indexar(ctx.guardia, ctx.config),
  };
}
