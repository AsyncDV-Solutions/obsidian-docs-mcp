# asyncdv-docs

Servidor MCP que documenta un proyecto de código en un vault de Obsidian. El modelo prepara cambios, la persona los aprueba y solo entonces se escriben.

## Language

### Notas

**Nota**:
Un archivo Markdown del proyecto dentro del vault, con propiedades YAML y un cuerpo.
_Avoid_: documento, archivo, página

**Tipo de nota**:
La clase de una nota (tarea, funcionalidad, guía, decisión, incidencia, release). Determina su carpeta, la forma de su id y su plantilla.
_Avoid_: categoría, clase, kind

**Nota del sistema**:
Una nota que el MCP necesita para funcionar y que la persona crea al iniciar el proyecto: el marcador del proyecto, los contadores y el tablero.
_Avoid_: nota interna, metadato

**Id**:
El identificador de una nota numerada o de un release, con el prefijo del proyecto delante. Los releases no se numeran: su id lleva la versión.
_Avoid_: código, número, folio

**Enlace**:
La referencia de Obsidian a una nota: nombra su ruta completa dentro del vault y muestra su id.
_Avoid_: link, wikilink, referencia

**Fuente**:
La cita de dónde sale lo que dice una nota: un archivo del repo o un documento, con el commit contra el que se revisó.
_Avoid_: origen, cita, referencia

**Contadores**:
La nota del sistema que guarda el último número usado por cada tipo de nota numerado. Un número nunca se reutiliza, aunque la nota que lo llevaba se borre.
_Avoid_: secuencia, autoincremento

**Bloque gestionado**:
Un tramo del cuerpo de una nota, delimitado por marcadores, que solo el MCP reescribe. Todo lo que está fuera de los bloques es de la persona.
_Avoid_: sección, región, área gestionada

**Historial**:
El bloque gestionado que registra, una línea por cambio, quién pidió cada cambio aplicado a una nota, cuándo y con qué herramienta.
_Avoid_: log, bitácora, changelog de la nota

**Editado a mano**:
El estado de un bloque gestionado cuyo contenido cambió fuera del MCP desde la última vez que el MCP lo escribió.
_Avoid_: modificado, sucio, desincronizado

**Texto libre**:
Texto que aporta el modelo y que se escribe dentro de una nota. Tiene un tope de tamaño, se recorta y no puede contener los marcadores de un bloque gestionado.
_Avoid_: entrada, input, contenido del usuario

**Versión de una nota**:
La huella del contenido de una nota tal como se leyó. Un cambio preparado sobre esa nota solo se aplica si la nota sigue en esa versión.
_Avoid_: hash, etag, revisión

### Cambios

**Cambio preparado**:
Un conjunto de operaciones sobre notas (crear una nota nueva o reemplazar una existente) listo para aplicarse pero todavía no escrito. Se identifica por su código de confirmación.
_Avoid_: borrador, propuesta, cambio pendiente, transacción

**Vista previa**:
El texto que muestra exactamente lo que un cambio preparado escribiría: el contenido completo de cada nota nueva y el diff de cada nota reemplazada, precedidos por los avisos.
_Avoid_: preview, resumen, dry run

**Código de confirmación**:
La clave de un solo uso con la que la persona aprueba un cambio preparado. Vence a los pocos minutos y no se puede reutilizar.
_Avoid_: token, ticket, id del cambio

**Aplicar**:
Escribir en el vault las operaciones de un cambio preparado, todas o ninguna en cuanto a verificación previa.
_Avoid_: guardar, ejecutar, commitear
