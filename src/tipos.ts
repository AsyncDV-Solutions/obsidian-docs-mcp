// Los tipos de nota que tienen documento propio, declarados una vez: la letra de su id, si se numera, la carpeta donde
// viven (la clave de config.carpetas) y el contrato de su plantilla. Los ids, las plantillas y crear leen de aquí:
// agregar un tipo es agregar una entrada, y su preparador.
//
// El contrato de la plantilla son los campos {{así}} que debe usar y los bloques gestionados que debe traer. Las
// propiedades de cada nota las arma el código, no la plantilla, para garantizar el esquema.
import type { Config } from './config.ts';

// Lo que exige una plantilla. Un formato anterior es el que una plantilla PROPIA (plantillas_dir) todavía puede usar
// para no romperse al actualizar el MCP: crea la nota con sus campos {{…}}, pero sin los bloques gestionados que el
// formato vigente sí trae, así que esas notas no se pueden editar con *_actualizar (dan BLOQUE_FALTA).
export type Formato = { campos: readonly string[]; bloques: readonly string[] };
export type Contrato = Formato & { anteriores?: readonly Formato[] };

type Declaracion = {
  letra: string; // en el id, con el prefijo del proyecto: PRJ-T-0001, PRJ-ADR-0001. El release lleva la versión: PRJ-R-v1.2.3
  numerada: boolean; // los contadores reparten su número; si no, el id lo trae quien crea la nota
  carpeta: keyof Config['carpetas'];
  plantilla: Contrato;
};

export const TIPOS_DE_NOTA = {
  tarea: { letra: 'T', numerada: true, carpeta: 'tareas', plantilla: { campos: ['descripcion', 'criterios'], bloques: ['historial'] } },
  // Versión 1.2.0: el contenido va en bloques gestionados para que funcionalidad_actualizar pueda reescribirlo.
  funcionalidad: { letra: 'F', numerada: true, carpeta: 'funcionalidades', plantilla: { campos: [], bloques: ['que_hace', 'afirmaciones', 'pendientes', 'historial'] } },
  incidencia: { letra: 'I', numerada: true, carpeta: 'incidencias', plantilla: { campos: ['sintoma', 'impacto', 'causa'], bloques: ['historial'] } },
  decision: { letra: 'ADR', numerada: true, carpeta: 'decisiones', plantilla: { campos: ['contexto', 'decision', 'alternativas', 'consecuencias'], bloques: [] } },
  release: { letra: 'R', numerada: false, carpeta: 'releases', plantilla: { campos: [], bloques: ['release'] } }, // su contenido lo genera el código dentro del bloque
  // Versión 2.1.0: igual que la funcionalidad, para que guia_actualizar pueda reescribirla.
  guia: {
    letra: 'G',
    numerada: true,
    carpeta: 'guias',
    plantilla: {
      campos: [],
      bloques: ['proposito', 'pasos', 'problemas', 'afirmaciones', 'pendientes', 'historial'],
      anteriores: [{ campos: ['proposito', 'pasos', 'problemas', 'afirmaciones', 'pendientes'], bloques: [] }], // hasta la 2.0.0
    },
  },
} as const satisfies Record<string, Declaracion>;

export type TipoDeNota = keyof typeof TIPOS_DE_NOTA;

// Los que reparten los contadores: todos menos el release, en el orden de la declaración.
export type TipoNumerado = { [T in TipoDeNota]: (typeof TIPOS_DE_NOTA)[T]['numerada'] extends true ? T : never }[TipoDeNota];

export const TIPOS_NUMERADOS = (Object.keys(TIPOS_DE_NOTA) as TipoDeNota[]).filter((tipo): tipo is TipoNumerado => TIPOS_DE_NOTA[tipo].numerada);
