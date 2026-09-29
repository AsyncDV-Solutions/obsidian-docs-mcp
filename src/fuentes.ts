// Las fuentes: la cita de dónde sale lo que dice una nota. Una fuente de git es «repo:<ruta>@<sha>», un archivo del
// repo, o «doc:<ruta>#<sección>@<sha>», un documento, siempre con el commit contra el que se revisó. Es el único
// lugar que sabe cómo se escribe y cómo se lee una.
export type FuenteGit = { tipo: 'repo' | 'doc'; ruta: string; sha: string };

const FUENTE_GIT = /^(repo|doc):([^#@]+)(?:#[^@]*)?@([0-9a-f]{7,40})$/;

export function fuenteRepo(ruta: string, sha: string): string {
  return `repo:${ruta}@${sha}`;
}

// La fuente de git que dice el texto, o null si no es una: una fuente de otra clase o un texto cualquiera.
export function leerFuenteGit(texto: string): FuenteGit | null {
  const m = FUENTE_GIT.exec(texto);
  if (m === null) return null;
  return { tipo: m[1] === 'doc' ? 'doc' : 'repo', ruta: m[2] ?? '', sha: m[3] ?? '' };
}

// La cita de un archivo leído del repo. Si tiene cambios sin commitear lo dice: el contenido no es el de ese commit,
// y por eso esa cita ya no se puede leer de vuelta con leerFuenteGit.
export function citarArchivo(ruta: string, sha: string, conCambios: boolean): string {
  return `${fuenteRepo(ruta, sha)}${conCambios ? ' (OJO: el archivo tiene cambios sin commitear; el contenido no es el de ese commit)' : ''}`;
}
