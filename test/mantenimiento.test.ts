import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validarArranque } from '../src/arranque.ts';
import { ErrorMcp } from '../src/errores.ts';
import { notasDesactualizadas } from '../src/mantenimiento.ts';
import { crearGuardia } from '../src/guardia.ts';
import { indexar } from '../src/notas.ts';
import type { Indice, Nota } from '../src/notas.ts';
import { consultasGitFalsas } from './consultas-git-falsas.ts';
import { commitear, convertirEnRepoGit, crearEscenario, escribirNota, gitDirecto, notaTarea, rutaGit } from './helpers.ts';

test('fuente desactualizada', async () => {
  const esc = await crearEscenario();
  try {
    await convertirEnRepoGit(esc.repo);
    await escribirNota(esc.repo, 'docs/a.md', 'a\n');
    commitear(esc.repo, 'feat: base');
    const sha = gitDirecto(esc.repo, 'rev-parse', '--short', 'HEAD').trim();
    await esc.escribirConfig({ git_path: rutaGit() });
    await escribirNota(esc.proyecto, 'Tareas/DEM-T-0001-a.md', notaTarea({ id: 'DEM-T-0001', titulo: 'A', extra: [`source:\n  - repo:docs/a.md@${sha}`] }));
    const estado = await validarArranque(['--config', esc.rutaConfig], {});
    assert.ok(estado.ok);
    const g = crearGuardia(estado.ctx.proyecto, estado.ctx.config.limites);
    const antes = await notasDesactualizadas(estado.ctx, await indexar(g, estado.ctx.config));
    assert.deepEqual([antes.desactualizadas.length, antes.revisadas], [0, 1]);
    await escribirNota(esc.repo, 'docs/a.md', 'a2\n');
    commitear(esc.repo, 'docs: cambia a');
    const despues = await notasDesactualizadas(estado.ctx, await indexar(g, estado.ctx.config));
    assert.equal(despues.desactualizadas.length, 1);
    assert.equal(despues.desactualizadas[0]?.id, 'DEM-T-0001');
  } finally {
    await esc.limpiar();
  }
});

// Las fuentes de las notas se leen del índice: no hace falta un repo para ver qué cuenta y qué se omite.
test('qué fuentes se comparan con git, cuáles se omiten y cuántas se revisan como máximo', async () => {
  const esc = await crearEscenario();
  try {
    const estado = await validarArranque(['--config', esc.rutaConfig], {});
    assert.ok(estado.ok);
    const consultadas: string[] = [];
    const ctx = {
      ...estado.ctx,
      consultasGit: consultasGitFalsas({
        ultimoCambioDesde: async (sha, ruta) => {
          consultadas.push(`${sha} ${ruta}`);
          if (sha === 'aaaaaaa') return '';
          if (sha === 'bbbbbbb') return `abc1234 2026-09-29 cambia ${ruta}`;
          throw new ErrorMcp('GIT', 'el SHA no está en el clon');
        },
      }),
    };
    const nota = (id: string, fuentes: string[]): Nota => ({ ruta: `Tareas/${id}.md`, version: 'v', id, tipo: 'tarea', titulo: id, datos: { source: fuentes }, cuerpo: '' });
    const indice: Indice = {
      notas: [
        nota('DEM-T-0001', ['repo:docs/a.md@aaaaaaa', 'repo:docs/b.md@bbbbbbb', 'doc:docs/guia.md#Sección@bbbbbbb']),
        nota('DEM-T-0002', ['repo:docs/c.md@ccccccc', 'repo:.env@bbbbbbb', 'repo:../fuera.md@bbbbbbb', 'web:https://ejemplo.dev', 'texto libre']),
      ],
      anomalias: [],
      truncado: false,
    };

    const r = await notasDesactualizadas(ctx, indice);
    assert.deepEqual(
      r.desactualizadas.map((d) => [d.id, d.fuente, d.commit]),
      [
        ['DEM-T-0001', 'repo:docs/b.md@bbbbbbb', 'abc1234 2026-09-29 cambia docs/b.md'],
        ['DEM-T-0001', 'doc:docs/guia.md#Sección@bbbbbbb', 'abc1234 2026-09-29 cambia docs/guia.md'],
      ],
    );
    // Se revisan cuatro. Se omiten tres: un SHA que no está en el clon, un archivo excluido y una ruta inválida.
    // Una fuente que no es de git, o un texto cualquiera, ni se cuenta.
    assert.deepEqual([r.revisadas, r.omitidas], [4, 3]);
    assert.deepEqual(consultadas, ['aaaaaaa docs/a.md', 'bbbbbbb docs/b.md', 'bbbbbbb docs/guia.md', 'ccccccc docs/c.md'], 'el archivo excluido y la ruta inválida no llegan a git');

    const tope = await notasDesactualizadas(ctx, indice, 2);
    assert.deepEqual([tope.revisadas, tope.omitidas], [2, 4], 'pasado el tope, lo demás se omite');
  } finally {
    await esc.limpiar();
  }
});
