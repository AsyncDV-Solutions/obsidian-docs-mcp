import type { Sesion } from './sesion.ts';
import { ErrorMcp } from './errores.ts';
import { leerFuenteConCommit } from './fuentes.ts';
import { comoLista } from './notas.ts';
import { excluida, validarRelativaRepo } from './repo.ts';

export type Desactualizada = { id: string; fuente: string; commit: string };

// Una fuente quedó atrás si su archivo tuvo commits después del SHA revisado.
export async function notasDesactualizadas(
  sesion: Sesion,
  maxFuentes = 200,
): Promise<{ desactualizadas: Desactualizada[]; revisadas: number; omitidas: number }> {
  const indice = await sesion.indice();
  const desactualizadas: Desactualizada[] = [];
  let revisadas = 0;
  let omitidas = 0;
  for (const nota of indice.notas) {
    for (const fuente of comoLista(nota.datos.source)) {
      const conCommit = leerFuenteConCommit(fuente);
      if (conCommit === null) continue;
      if (revisadas >= maxFuentes) {
        omitidas++;
        continue;
      }
      let relativa: string;
      try {
        relativa = validarRelativaRepo(conCommit.ruta);
      } catch {
        omitidas++;
        continue;
      }
      if (excluida(sesion, relativa)) {
        omitidas++;
        continue;
      }
      revisadas++;
      let salida: string;
      try {
        salida = await sesion.consultasGit.ultimoCambioDesde(conCommit.sha, relativa);
      } catch (error) {
        if (!(error instanceof ErrorMcp && error.codigo === 'GIT')) throw error; // sin git no se sabe qué quedó atrás
        omitidas++; // el SHA no existe en tu clon local
        continue;
      }
      if (salida !== '') desactualizadas.push({ id: nota.id || nota.ruta, fuente, commit: salida });
    }
  }
  return { desactualizadas, revisadas, omitidas };
}
