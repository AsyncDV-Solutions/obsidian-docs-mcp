// Las fuentes: de dónde sale lo que dice una nota. Una fuente con commit es «repo:<ruta>@<sha>», un archivo del repo,
// o «doc:<ruta>#<sección>@<sha>», un documento: el commit contra el que se revisó. Este módulo escribe las del repo
// y lee las dos; las de documento las aporta el modelo. Las fuentes de otra clase, como «web:», no llevan commit y
// aquí no se leen.
//
// El formato no escapa «@» ni «#» dentro de la ruta. Con «@» la fuente se escribe pero el lector la rechaza, y
// notas_desactualizadas la salta sin contarla. Con «#» el lector toma lo que sigue por la sección de un documento y
// devuelve una ruta cortada.
export type FuenteConCommit = { ruta: string; sha: string };

// El SHA de un commit, entero o abreviado: los esquemas de las herramientas lo exigen así.
export const PATRON_SHA = /^[0-9a-f]{7,40}$/;

const FUENTE_CON_COMMIT = /^(?:repo|doc):([^#@]+)(?:#[^@]*)?@([0-9a-f]{7,40})$/;

export function fuenteRepo(ruta: string, sha: string): string {
  return `repo:${ruta}@${sha}`;
}

// La ruta y el commit de la fuente que dice el texto, o null si no lleva commit: otra clase de fuente o un texto cualquiera.
export function leerFuenteConCommit(texto: string): FuenteConCommit | null {
  const m = FUENTE_CON_COMMIT.exec(texto);
  if (m === null) return null;
  return { ruta: m[1] ?? '', sha: m[2] ?? '' };
}
