import { createHash } from 'node:crypto';
import { ErrorMcp } from './errores.ts';

// Bloques gestionados: solo el MCP reescribe lo que está entre sus marcadores.
//   %% asyncdv:inicio <nombre> h=<huella> %%
//   …contenido…
//   %% asyncdv:fin %%
// La huella detecta si alguien editó el contenido a mano desde la última escritura del MCP.
// Lo que está entre %% … %% solo se ve en el modo edición de Obsidian.

function huella(contenido: string): string {
  return createHash('sha256').update(contenido.replaceAll('\r\n', '\n'), 'utf8').digest('hex').slice(0, 12);
}

export type Bloque = { contenido: string; editadoAMano: boolean; desde: number; hasta: number };

export function leerBloque(cuerpo: string, nombre: string): Bloque | null {
  // (?=\r?$): el \r de CRLF queda fuera del marcador, así se conservan los saltos originales.
  const inicio = new RegExp(`^%% asyncdv:inicio ${nombre}(?: h=([0-9a-f]{12}))? %%(?=\\r?$)`, 'm').exec(cuerpo);
  if (inicio === null) return null;
  const desdeContenido = inicio.index + inicio[0].length;
  const resto = cuerpo.slice(desdeContenido);
  const fin = /^%% asyncdv:fin %%(?=\r?$)/m.exec(resto);
  if (fin === null) throw new ErrorMcp('BLOQUE_ROTO', `El bloque «${nombre}» no tiene su marcador de fin.`);
  const contenido = resto.slice(0, fin.index).replace(/^\r?\n/, '').replace(/\r?\n$/, '');
  const declarada = inicio[1];
  return {
    contenido,
    editadoAMano: declarada !== undefined && declarada !== huella(contenido),
    desde: inicio.index,
    hasta: desdeContenido + fin.index + fin[0].length,
  };
}

// Reemplaza el contenido del bloque y renueva su huella. Lo de afuera no cambia ni un byte.
export function escribirBloque(cuerpo: string, nombre: string, contenido: string, eol: string): string {
  const bloque = leerBloque(cuerpo, nombre);
  if (bloque === null) throw new ErrorMcp('BLOQUE_FALTA', `La nota no tiene el bloque «${nombre}».`);
  const nuevo = [`%% asyncdv:inicio ${nombre} h=${huella(contenido)} %%`, contenido, '%% asyncdv:fin %%'].join(eol);
  return cuerpo.slice(0, bloque.desde) + nuevo + cuerpo.slice(bloque.hasta);
}
