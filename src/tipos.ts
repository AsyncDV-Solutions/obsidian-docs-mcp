// Los tipos de nota, declarados en un solo lugar: la letra de su id, si se numera, la clave de su carpeta en
// config.carpetas y el contrato de su plantilla. Los ids, las plantillas, el arranque y crear leen de aquí. Un tipo
// nuevo pide además su carpeta en config.carpetas, su lugar en TIPOS y TIPOS_ITEM de dominio.ts (test/tipos.test.ts
// vigila los tres), su plantilla y su preparador.
//
// El contrato de la plantilla son los campos {{así}} que debe usar y los bloques gestionados que debe traer. Las
// propiedades de cada nota las arma el código, no la plantilla, para garantizar el esquema.
import type { Config } from './config.ts';

// Lo que exige una plantilla de nota.
export type FormatoDePlantilla = { campos: readonly string[]; bloques: readonly string[] };

// El formato anterior es el que una plantilla PROPIA (plantillas_dir) todavía puede usar para no romperse al
// actualizar el MCP: crea la nota con sus campos {{…}}, pero sin los bloques gestionados que el formato vigente sí
// trae, así que esas notas no se pueden editar con *_actualizar (dan BLOQUE_FALTA).
export type Contrato = FormatoDePlantilla & { anterior?: FormatoDePlantilla };

type Declaracion = {
  letra: string; // en el id, con el prefijo del proyecto: PRJ-T-0001, PRJ-ADR-0001. El release lleva la versión: PRJ-R-v1.2.3
  numerado: boolean; // los contadores reparten su número; si no, el id lo trae quien crea la nota
  claveCarpeta: keyof Config['carpetas'];
  contrato: Contrato;
};

export const TIPOS_DE_NOTA = {
  tarea: { letra: 'T', numerado: true, claveCarpeta: 'tareas', contrato: { campos: ['descripcion', 'criterios'], bloques: ['historial'] } },
  // Versión 1.2.0: el contenido va en bloques gestionados para que funcionalidad_actualizar pueda reescribirlo.
  funcionalidad: { letra: 'F', numerado: true, claveCarpeta: 'funcionalidades', contrato: { campos: [], bloques: ['que_hace', 'afirmaciones', 'pendientes', 'historial'] } },
  incidencia: { letra: 'I', numerado: true, claveCarpeta: 'incidencias', contrato: { campos: ['sintoma', 'impacto', 'causa'], bloques: ['historial'] } },
  decision: { letra: 'ADR', numerado: true, claveCarpeta: 'decisiones', contrato: { campos: ['contexto', 'decision', 'alternativas', 'consecuencias'], bloques: [] } },
  release: { letra: 'R', numerado: false, claveCarpeta: 'releases', contrato: { campos: [], bloques: ['release'] } }, // su contenido lo genera el código dentro del bloque
  // Versión 2.1.0: igual que la funcionalidad, para que guia_actualizar pueda reescribirla.
  guia: {
    letra: 'G',
    numerado: true,
    claveCarpeta: 'guias',
    contrato: {
      campos: [],
      bloques: ['proposito', 'pasos', 'problemas', 'afirmaciones', 'pendientes', 'historial'],
      anterior: { campos: ['proposito', 'pasos', 'problemas', 'afirmaciones', 'pendientes'], bloques: [] }, // hasta la 2.0.0
    },
  },
} as const satisfies Record<string, Declaracion>;

export type TipoDeNota = keyof typeof TIPOS_DE_NOTA;

export const TIPOS_DECLARADOS = Object.keys(TIPOS_DE_NOTA) as TipoDeNota[];

// Los que reparten los contadores: todos menos el release, en el orden de la declaración.
export type TipoNumerado = { [T in TipoDeNota]: (typeof TIPOS_DE_NOTA)[T]['numerado'] extends true ? T : never }[TipoDeNota];

export const TIPOS_NUMERADOS = TIPOS_DECLARADOS.filter((tipo): tipo is TipoNumerado => TIPOS_DE_NOTA[tipo].numerado);
