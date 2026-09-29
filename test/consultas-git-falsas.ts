import { ErrorMcp } from '../src/errores.ts';
import type { ConsultasGit } from '../src/git.ts';

// Un ConsultasGit de mentira, el segundo adaptador del seam: cada prueba declara lo que git responde y ejercita
// las decisiones y los fallos sin lanzar procesos. Lo que la prueba no declara falla, para que nunca dependa de
// algo que no dijo.
export function consultasGitFalsas(respuestas: Partial<ConsultasGit> = {}): ConsultasGit {
  const sinDeclarar =
    (nombre: string) =>
    (): never => {
      throw new Error(`consultasGitFalsas: la prueba no declaró «${nombre}»`);
    };
  return {
    resolver: sinDeclarar('resolver'),
    cabezaCorta: sinDeclarar('cabezaCorta'),
    ramaActual: sinDeclarar('ramaActual'),
    tags: sinDeclarar('tags'),
    commitsEntre: sinDeclarar('commitsEntre'),
    commitsRecientes: sinDeclarar('commitsRecientes'),
    contarCommitsEntre: sinDeclarar('contarCommitsEntre'),
    archivosCambiados: sinDeclarar('archivosCambiados'),
    archivosConMarcador: sinDeclarar('archivosConMarcador'),
    ultimoCambioDesde: sinDeclarar('ultimoCambioDesde'),
    cambiosSinConfirmar: sinDeclarar('cambiosSinConfirmar'),
    ...respuestas,
  };
}

// Un fallo de git, como el que entrega el adaptador real.
export const falloDeGit = (): Promise<never> => Promise.reject(new ErrorMcp('GIT', 'git falló o tardó demasiado.'));
