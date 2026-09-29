import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import path from 'node:path';

// Log del MCP: stderr y, si el arranque fue válido, <carpeta de estado>/logs/mcp.log.
// Regla: solo códigos, nombres de herramienta, ids y números. Nunca contenido de notas,
// texto libre ni rutas absolutas.
type Dato = string | number | boolean;

const MAX_BYTES = 1024 * 1024; // 1 MB por archivo; se conserva uno anterior (mcp.1.log)
let archivo: string | null = null;

export function activarLogArchivo(dirEstado: string): void {
  try {
    const carpeta = path.join(dirEstado, 'logs');
    mkdirSync(carpeta, { recursive: true });
    archivo = path.join(carpeta, 'mcp.log');
  } catch {
    archivo = null; // sin archivo de log, el servidor sigue funcionando
  }
}

export function registrar(evento: string, datos: Record<string, Dato> = {}): void {
  const linea = `${JSON.stringify({ t: new Date().toISOString(), evento, ...datos })}\n`;
  process.stderr.write(linea);
  if (archivo === null) return;
  try {
    const tamano = statSync(archivo, { throwIfNoEntry: false })?.size ?? 0;
    if (tamano > MAX_BYTES) renameSync(archivo, archivo.replace(/\.log$/, '.1.log'));
    appendFileSync(archivo, linea, 'utf8');
  } catch {
    // un error al escribir el log nunca debe tumbar el servidor
  }
}
