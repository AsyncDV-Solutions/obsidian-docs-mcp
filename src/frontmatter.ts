import { isMap, parseDocument } from 'yaml';
import type { Document } from 'yaml';
import { ErrorMcp } from './errores.ts';

export type Eol = '\n' | '\r\n';

export type NotaSeparada = {
  bom: boolean;
  eol: Eol;
  doc: Document; // YAML editable: conserva comentarios, orden y claves desconocidas
  datos: Record<string, unknown>;
  cuerpo: string;
};

// Separa las propiedades del cuerpo. Tolera BOM y CRLF.
export function separarNota(texto: string, yamlMaxBytes: number): NotaSeparada {
  const bom = texto.startsWith('\uFEFF');
  const sinBom = bom ? texto.slice(1) : texto;
  const eol: Eol = sinBom.includes('\r\n') ? '\r\n' : '\n';
  const bloque = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(sinBom);
  if (bloque === null) {
    throw new ErrorMcp('SIN_PROPIEDADES', 'La nota no empieza con un bloque de propiedades (---).');
  }
  const yamlTexto = bloque[1] ?? '';
  if (Buffer.byteLength(yamlTexto, 'utf8') > yamlMaxBytes) {
    throw new ErrorMcp('YAML_GRANDE', 'El bloque de propiedades supera el tamaño máximo.');
  }
  const doc = parseDocument(yamlTexto, { uniqueKeys: true });
  if (doc.errors.length > 0) {
    const linea = doc.errors[0]?.linePos?.[0]?.line;
    throw new ErrorMcp('YAML_INVALIDO', `Las propiedades no son YAML válido${linea ? ` (línea ${linea})` : ''}.`);
  }
  if (!isMap(doc.contents)) {
    throw new ErrorMcp('YAML_NO_MAPA', 'Las propiedades deben ser pares «clave: valor».');
  }
  const datos = doc.toJS() as Record<string, unknown>;
  return { bom, eol, doc, datos, cuerpo: sinBom.slice(bloque[0].length) };
}

// Vuelve a armar la nota con el mismo BOM y los mismos saltos de línea. El cuerpo no se toca.
export function unirNota(nota: { bom: boolean; eol: Eol; doc: Document; cuerpo: string }): string {
  const yamlTexto = nota.doc.toString().replace(/\n$/, '');
  const cabecera = ['---', ...yamlTexto.split('\n'), '---'].join(nota.eol) + nota.eol;
  return (nota.bom ? '\uFEFF' : '') + cabecera + nota.cuerpo;
}
