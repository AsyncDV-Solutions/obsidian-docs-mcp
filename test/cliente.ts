import { InMemoryTransport } from '@modelcontextprotocol/server';
import type { EstadoArranque } from '../src/arranque.ts';
import { crearServidor } from '../src/servidor.ts';

export type Respuesta = {
  texto: string;
  estructurado: Record<string, unknown> | undefined; // structuredContent, si la herramienta lo entrega
  error: boolean; // isError: un error de la herramienta o una entrada que rompe el esquema
};

export type Definicion = { name: string; annotations?: Record<string, unknown> };

export type Cliente = {
  herramientas(): Promise<string[]>;
  definiciones(): Promise<Definicion[]>;
  llamar(nombre: string, args?: Record<string, unknown>): Promise<Respuesta>;
  cerrar(): Promise<void>;
};

type Mensaje = {
  id?: number;
  result?: { tools?: Definicion[]; content?: { text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };
  error?: { message: string };
};

const PLAZO_MS = 5000;

// Un cliente MCP mínimo: habla JSON-RPC con crearServidor por un transporte en memoria, sin red ni procesos.
// Vive aparte de helpers.ts para que las pruebas que no lo usan no carguen el servidor.
export async function servir(estado: EstadoArranque): Promise<Cliente> {
  const servidor = crearServidor(estado);
  const [lado, delServidor] = InMemoryTransport.createLinkedPair();
  await servidor.connect(delServidor);

  const pendientes = new Map<number, (m: Mensaje) => void>();
  lado.onmessage = (mensaje) => {
    const m = mensaje as Mensaje; // el SDK tipa result de forma abierta: acá solo se leen los campos que usan las pruebas
    if (typeof m.id === 'number') pendientes.get(m.id)?.(m);
  };
  await lado.start();

  const enviar = (mensaje: Parameters<typeof lado.send>[0]): Promise<void> => lado.send(mensaje);
  let ultimoId = 0;
  const pedir = (method: string, params: Record<string, unknown>): Promise<Mensaje> =>
    new Promise((resolver, rechazar) => {
      const id = ++ultimoId;
      const terminar = (): void => {
        clearTimeout(plazo);
        pendientes.delete(id);
      };
      const plazo = setTimeout(() => {
        terminar();
        rechazar(new Error(`sin respuesta a ${method}`));
      }, PLAZO_MS);
      pendientes.set(id, (m) => {
        terminar();
        resolver(m);
      });
      enviar({ jsonrpc: '2.0', id, method, params }).catch((error: unknown) => {
        terminar();
        rechazar(error);
      });
    });

  const inicio = await pedir('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'pruebas', version: '0' } });
  if (inicio.error !== undefined) throw new Error(`initialize falló: ${inicio.error.message}`);
  await enviar({ jsonrpc: '2.0', method: 'notifications/initialized' });

  const definiciones = async (): Promise<Definicion[]> => (await pedir('tools/list', {})).result?.tools ?? [];

  return {
    definiciones,
    async herramientas() {
      return (await definiciones()).map((h) => h.name).sort();
    },
    async llamar(nombre, args = {}) {
      const r = await pedir('tools/call', { name: nombre, arguments: args });
      if (r.error !== undefined) return { texto: r.error.message, estructurado: undefined, error: true };
      return { texto: (r.result?.content ?? []).map((c) => c.text).join('\n'), estructurado: r.result?.structuredContent, error: r.result?.isError === true };
    },
    async cerrar() {
      await lado.close();
      await servidor.close();
    },
  };
}
