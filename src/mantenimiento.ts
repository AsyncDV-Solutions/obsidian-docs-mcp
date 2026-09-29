import type { Contexto } from './arranque.ts';
import { comoLista } from './notas.ts';
import type { Indice } from './notas.ts';
import { excluida, git, validarRelativaRepo } from './repo.ts';

// Fuentes comparables con git: repo:<ruta>@<sha> y doc:<ruta>#<sección>@<sha>.
const FUENTE_GIT = /^(repo|doc):([^#@]+)(?:#[^@]*)?@([0-9a-f]{7,40})$/;

export type Desactualizada = { id: string; fuente: string; commit: string };

// Una fuente quedó atrás si su archivo tuvo commits después del SHA revisado.
export async function notasDesactualizadas(
  ctx: Contexto,
  indice: Indice,
  maxFuentes = 200,
): Promise<{ desactualizadas: Desactualizada[]; revisadas: number; omitidas: number }> {
  const desactualizadas: Desactualizada[] = [];
  let revisadas = 0;
  let omitidas = 0;
  for (const nota of indice.notas) {
    for (const fuente of comoLista(nota.datos.source)) {
      const m = FUENTE_GIT.exec(fuente);
      if (m === null) continue;
      if (revisadas >= maxFuentes) {
        omitidas++;
        continue;
      }
      let relativa: string;
      try {
        relativa = validarRelativaRepo(m[2] ?? '');
      } catch {
        omitidas++;
        continue;
      }
      if (excluida(ctx, relativa)) {
        omitidas++;
        continue;
      }
      revisadas++;
      let salida: string;
      try {
        salida = await git(ctx, ['log', '-n', '1', '--format=%h %ad %s', '--date=short', '--end-of-options', `${m[3] ?? ''}..HEAD`, '--', relativa]);
      } catch {
        omitidas++; // el SHA no existe en tu clon local
        continue;
      }
      if (salida.trim() !== '') desactualizadas.push({ id: nota.id || nota.ruta, fuente, commit: salida.trim() });
    }
  }
  return { desactualizadas, revisadas, omitidas };
}
