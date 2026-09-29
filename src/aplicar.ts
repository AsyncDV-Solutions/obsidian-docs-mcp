import { access } from 'node:fs/promises';
import { ErrorMcp } from './errores.ts';
import { conBloqueo } from './escritura.ts';
import { registrar } from './log.ts';
import type { Sesion } from './sesion.ts';

async function existe(ruta: string): Promise<boolean> {
  try {
    await access(ruta);
    return true;
  } catch {
    return false;
  }
}

// El ÚNICO camino que escribe en el vault.
export async function aplicarCambio(sesion: Sesion, confirmacion: string): Promise<string[]> {
  // Alcanzar el tope es una pausa, no una invalidación: se comprueba ANTES de consumir el código. Solo un código
  // válido gasta cupo, y todo lo que falle después de retirarlo también lo consume: el código sirve una sola vez.
  sesion.tope.exigir();
  const cambio = sesion.almacen.retirar(confirmacion);
  sesion.tope.contar();
  return conBloqueo(sesion.dirEstado, async () => {
    // 1. Verificar TODO antes de escribir nada.
    const destinos: string[] = [];
    for (const op of cambio.operaciones) {
      const absoluta = await sesion.guardia.rutaParaEscribir(op.ruta);
      if (op.tipo === 'reemplazar') {
        if ((await sesion.guardia.leer(op.ruta)).version !== op.versionEsperada) {
          throw new ErrorMcp('CONFLICTO', `${op.ruta} cambió desde la vista previa. No se escribió nada: vuelve a preparar el cambio.`);
        }
      } else if (await existe(absoluta)) {
        throw new ErrorMcp('YA_EXISTE', `${op.ruta} ya existe. No se escribió nada.`);
      }
      destinos.push(absoluta);
    }
    // 2. Aplicar en orden. Si algo falla a mitad de camino, se informa qué quedó hecho.
    const hechas: string[] = [];
    for (const [i, op] of cambio.operaciones.entries()) {
      const absoluta = destinos[i] ?? '';
      try {
        if (op.tipo === 'crear') await sesion.escritor.crearExclusivo(absoluta, op.contenido);
        else await sesion.escritor.reemplazarAtomico(absoluta, op.contenido, op.versionEsperada);
      } catch (error) {
        if (hechas.length === 0) throw error;
        const detalle = error instanceof ErrorMcp ? error.message : 'error de escritura';
        throw new ErrorMcp('PARCIAL', `Se aplicaron ${hechas.length} de ${cambio.operaciones.length} operaciones (${hechas.join(', ')}); falló ${op.ruta}: ${detalle}`);
      }
      hechas.push(`${op.tipo} ${op.ruta}`);
    }
    registrar('escritura', { operaciones: hechas.length });
    return hechas;
  });
}
