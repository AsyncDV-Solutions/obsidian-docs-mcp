import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validarArranque } from '../src/arranque.ts';
import { notasDesactualizadas } from '../src/mantenimiento.ts';
import { crearGuardia } from '../src/guardia.ts';
import { indexar } from '../src/notas.ts';
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
