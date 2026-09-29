import { randomBytes } from 'node:crypto';
import { ErrorMcp } from './errores.ts';

export type Operacion =
  | { tipo: 'crear'; ruta: string; contenido: string }
  | { tipo: 'reemplazar'; ruta: string; contenido: string; versionEsperada: string };

export type Cambio = { descripcion: string; operaciones: Operacion[] };

// Cambios preparados y todavía no aplicados. Viven en la memoria del proceso: si el servidor
// se reinicia, se pierden y hay que volver a prepararlos (falla cerrado, nunca abierto).
const pendientes = new Map<string, { cambio: Cambio; expira: number }>();

function limpiarVencidos(ahora: number): void {
  for (const [codigo, p] of pendientes) if (p.expira <= ahora) pendientes.delete(codigo);
}

export function guardarCambio(cambio: Cambio, minutos: number): { confirmacion: string; expira: Date } {
  const ahora = Date.now();
  limpiarVencidos(ahora);
  const confirmacion = randomBytes(16).toString('base64url'); // 128 bits aleatorios: no se puede adivinar
  const expira = ahora + minutos * 60_000;
  pendientes.set(confirmacion, { cambio, expira });
  return { confirmacion, expira: new Date(expira) };
}

// Entrega el cambio una sola vez: aunque aplicarlo falle después, el código ya no sirve.
export function tomarCambio(confirmacion: string): Cambio {
  limpiarVencidos(Date.now());
  const pendiente = pendientes.get(confirmacion);
  pendientes.delete(confirmacion);
  if (pendiente === undefined) {
    throw new ErrorMcp('CONFIRMACION_INVALIDA', 'El código no existe, ya se usó o venció. Vuelve a preparar el cambio.');
  }
  return pendiente.cambio;
}

// Tope de escrituras por minuto (ventana deslizante): la especificación MCP exige limitar la tasa.
const escrituras: number[] = [];

export function consumirCupo(maxPorMinuto: number): void {
  const ahora = Date.now();
  while (escrituras.length > 0 && (escrituras[0] ?? 0) <= ahora - 60_000) escrituras.shift();
  if (escrituras.length >= maxPorMinuto) {
    throw new ErrorMcp('LIMITE', `Se alcanzó el tope de ${maxPorMinuto} escrituras por minuto. Espera un momento.`);
  }
  escrituras.push(ahora);
}

// Diff de líneas para la vista previa: solo los cambios, con dos líneas de contexto.
export function diffLineas(antes: string, despues: string): string {
  const a = antes.split(/\r?\n/);
  const b = despues.split(/\r?\n/);
  if (a.length * b.length > 1_000_000) return '(nota demasiado grande para un diff: revisa el contenido completo)';
  // lcs[i][j] = largo de la subsecuencia común más larga entre a[i..] y b[j..]
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const lineas: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      lineas.push(`  ${a[i]}`);
      i++;
      j++;
    } else if (i < a.length && (j >= b.length || lcs[i + 1][j] >= lcs[i][j + 1])) {
      lineas.push(`- ${a[i]}`);
      i++;
    } else {
      lineas.push(`+ ${b[j]}`);
      j++;
    }
  }
  const cambia = lineas.map((l) => !l.startsWith('  '));
  const salida: string[] = [];
  let omitiendo = false;
  lineas.forEach((l, k) => {
    if (cambia.slice(Math.max(0, k - 2), k + 3).some(Boolean)) {
      salida.push(l);
      omitiendo = false;
    } else if (!omitiendo) {
      salida.push('  …');
      omitiendo = true;
    }
  });
  return salida.join('\n');
}
