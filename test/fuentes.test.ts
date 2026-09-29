import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { citarArchivo, fuenteRepo, leerFuenteGit } from '../src/fuentes.ts';

describe('fuentes', () => {
  test('fuenteRepo escribe repo:<ruta>@<sha> y leerFuenteGit lo lee de vuelta', () => {
    const fuente = fuenteRepo('src/pedidos/crear.ts', '3e22c9c');
    assert.equal(fuente, 'repo:src/pedidos/crear.ts@3e22c9c');
    assert.deepEqual(leerFuenteGit(fuente), { tipo: 'repo', ruta: 'src/pedidos/crear.ts', sha: '3e22c9c' });
  });

  test('leerFuenteGit lee también los documentos con sección y descarta lo que no es una fuente de git', () => {
    assert.deepEqual(leerFuenteGit('doc:docs/guia.md#Sección@abc1234f'), { tipo: 'doc', ruta: 'docs/guia.md', sha: 'abc1234f' });
    assert.equal(leerFuenteGit(`repo:docs/a.md@${'a'.repeat(40)}`)?.sha, 'a'.repeat(40));
    const noSon = ['web:https://ejemplo.dev', 'texto libre', 'repo:docs/a.md', 'repo:docs/a.md@abc123', `repo:docs/a.md@${'a'.repeat(41)}`, 'repo:@aaaaaaa', 'repo:docs/a.md@AAAAAAA', 'otro:docs/a.md@aaaaaaa'];
    for (const texto of noSon) assert.equal(leerFuenteGit(texto), null, texto);
  });

  test('citarArchivo avisa si el archivo tiene cambios sin commitear', () => {
    assert.equal(citarArchivo('docs/a.md', 'abc1234', false), 'repo:docs/a.md@abc1234');
    assert.equal(citarArchivo('docs/a.md', 'abc1234', true), 'repo:docs/a.md@abc1234 (OJO: el archivo tiene cambios sin commitear; el contenido no es el de ese commit)');
  });
});
