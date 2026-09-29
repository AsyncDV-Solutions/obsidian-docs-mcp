// Dónde esperan los cambios preparados y cuántas escrituras se aceptan por minuto. Es estado del proceso: si el
// servidor se reinicia, los códigos se pierden y hay que volver a preparar el cambio (falla cerrado, nunca abierto).
// Cada sesión (sesion.ts) tiene el suyo, y el reloj se inyecta para probar el vencimiento sin esperar.
import { randomBytes } from 'node:crypto';
import type { Cambio } from './cambios.ts';
import { ErrorMcp } from './errores.ts';

// Milisegundos desde 1970, como Date.now.
export type Reloj = () => number;

const MINUTO_MS = 60_000;

export type Almacen = {
  // Guarda un cambio preparado y entrega su código de confirmación, con los minutos que tarda en vencer.
  guardar(cambio: Cambio): { confirmacion: string; minutos: number };
  // Entrega el cambio de un código válido y lo borra: sirve una sola vez. CONFIRMACION_INVALIDA si no existe,
  // ya se usó o venció.
  retirar(confirmacion: string): Cambio;
};

// minutos: lo que dura un código (confirmacion_minutos).
export function crearAlmacen(reloj: Reloj, minutos: number): Almacen {
  const guardados = new Map<string, { cambio: Cambio; expira: number }>();

  const limpiarVencidos = (instante: number): void => {
    for (const [codigo, guardado] of guardados) if (guardado.expira <= instante) guardados.delete(codigo);
  };

  return {
    guardar(cambio) {
      const instante = reloj();
      limpiarVencidos(instante);
      const confirmacion = randomBytes(16).toString('base64url'); // 128 bits aleatorios: no se puede adivinar
      guardados.set(confirmacion, { cambio, expira: instante + minutos * MINUTO_MS });
      return { confirmacion, minutos };
    },
    retirar(confirmacion) {
      limpiarVencidos(reloj());
      const guardado = guardados.get(confirmacion);
      guardados.delete(confirmacion);
      if (guardado === undefined) {
        throw new ErrorMcp('CONFIRMACION_INVALIDA', 'El código no existe, ya se usó o venció. Vuelve a preparar el cambio.');
      }
      return guardado.cambio;
    },
  };
}

// Tope de escrituras por minuto (ventana deslizante): la especificación MCP exige limitar la tasa.
export type Tope = {
  // LIMITE si ya se gastó todo el cupo del último minuto. No gasta cupo: alcanzar el tope es una pausa.
  exigir(): void;
  // Anota una escritura en la ventana.
  contar(): void;
};

export function crearTope(reloj: Reloj, maxPorMinuto: number): Tope {
  const escrituras: number[] = [];
  return {
    exigir() {
      const instante = reloj();
      while (escrituras.length > 0 && (escrituras[0] ?? 0) <= instante - MINUTO_MS) escrituras.shift();
      if (escrituras.length >= maxPorMinuto) {
        throw new ErrorMcp('LIMITE', `Se alcanzó el tope de ${maxPorMinuto} escrituras por minuto. Espera un momento.`);
      }
    },
    contar() {
      escrituras.push(reloj());
    },
  };
}
