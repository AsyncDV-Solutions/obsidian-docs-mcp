// Errores del MCP: un código estable (log y pruebas) y un mensaje claro (para el modelo).
// El mensaje nunca incluye rutas absolutas ni contenido de notas.
export class ErrorMcp extends Error {
  readonly codigo: string;

  constructor(codigo: string, mensaje: string) {
    super(mensaje);
    this.name = 'ErrorMcp';
    this.codigo = codigo;
  }
}

export type Resultado = {
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

export function ok(texto: string): Resultado {
  return { content: [{ type: 'text', text: texto }] };
}

export function falla(texto: string): Resultado {
  return { content: [{ type: 'text', text: texto }], isError: true };
}

// Convierte cualquier error en un resultado para el modelo, sin filtrar detalles internos.
export function aResultado(error: unknown): Resultado {
  if (error instanceof ErrorMcp) return falla(`[${error.codigo}] ${error.message}`);
  return falla('[INTERNO] Error inesperado. Revisa el log del MCP.');
}
