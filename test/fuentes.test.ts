import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { fuenteRepo, leerFuenteConCommit, PATRON_SHA } from '../src/fuentes.ts';

describe('fuentes', () => {
  test('fuenteRepo escribe repo:<ruta>@<sha> y leerFuenteConCommit lo lee de vuelta', () => {
    const fuente = fuenteRepo('src/pedidos/crear.ts', '3e22c9c');
    assert.equal(fuente, 'repo:src/pedidos/crear.ts@3e22c9c');
    assert.deepEqual(leerFuenteConCommit(fuente), { ruta: 'src/pedidos/crear.ts', sha: '3e22c9c' });
  });

  test('leerFuenteConCommit lee también los documentos con sección y descarta lo que no lleva commit', () => {
    assert.deepEqual(leerFuenteConCommit('doc:docs/guia.md#Sección@abc1234f'), { ruta: 'docs/guia.md', sha: 'abc1234f' });
    assert.equal(leerFuenteConCommit(`repo:docs/a.md@${'a'.repeat(40)}`)?.sha, 'a'.repeat(40));
    const noSon = ['web:https://ejemplo.dev', 'texto libre', 'repo:docs/a.md', 'repo:docs/a.md@abc123', `repo:docs/a.md@${'a'.repeat(41)}`, 'repo:@aaaaaaa', 'repo:docs/a.md@AAAAAAA', 'otro:docs/a.md@aaaaaaa'];
    for (const texto of noSon) assert.equal(leerFuenteConCommit(texto), null, texto);
  });

  // Límite del formato, que hoy se conserva: fuenteRepo no escapa nada.
  test('una ruta con «@» no se lee de vuelta, y una con «#» se lee cortada', () => {
    const conArroba = fuenteRepo('src/@types/x.d.ts', 'abc1234');
    assert.equal(conArroba, 'repo:src/@types/x.d.ts@abc1234');
    assert.equal(leerFuenteConCommit(conArroba), null);
    const conAlmohadilla = fuenteRepo('docs/a#b.md', 'abc1234');
    assert.equal(conAlmohadilla, 'repo:docs/a#b.md@abc1234');
    assert.deepEqual(leerFuenteConCommit(conAlmohadilla), { ruta: 'docs/a', sha: 'abc1234' });
  });

  test('PATRON_SHA acepta de 7 a 40 dígitos hexadecimales en minúscula', () => {
    for (const sha of ['abc1234', '0'.repeat(40)]) assert.match(sha, PATRON_SHA);
    for (const sha of ['abc123', '0'.repeat(41), 'ABC1234', 'abc123g', 'abc1234\n', '']) assert.doesNotMatch(sha, PATRON_SHA, JSON.stringify(sha));
  });
});
