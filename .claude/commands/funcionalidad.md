---
description: Documenta una funcionalidad a partir de archivos del repo, con evidencia y fuente; si ya existe, la actualiza
argument-hint: <key tipo:nombre> <ruta del repo> [otra ruta…]
allowed-tools: mcp__asyncdv-docs__repo_archivo_leer, mcp__asyncdv-docs__repo_inventario, mcp__asyncdv-docs__repo_git_resumen, mcp__asyncdv-docs__notas_buscar, mcp__asyncdv-docs__items_listar, mcp__asyncdv-docs__nota_leer, mcp__asyncdv-docs__funcionalidad_crear, mcp__asyncdv-docs__funcionalidad_actualizar
---
Con asyncdv-docs, prepara una nota de funcionalidad: $ARGUMENTS

El primer argumento es la `key` (formato `tipo:nombre`, p. ej. `modulo:quotes`); el resto son rutas del repo a leer.

Pasos:
1. Busca con `items_listar` (tipo `funcionalidad`) y `notas_buscar` si ya hay una funcionalidad con esa key o tema.
2. Lee cada ruta con `repo_archivo_leer`. Si una ruta no permite leer contenido, dilo y usa `repo_inventario` solo para los nombres.
3. Redacta las afirmaciones **solo con lo que leíste**. Cada una lleva su `evidencia` (`verificado-en-codigo` si la viste en el código; `solo-documentacion`, `propuesto` o `pendiente-de-validar` en otro caso) y su `fuente`.
4. `reviewed_commit` y las `fuentes` (`repo:<ruta>@<sha>`) salen del SHA que devolvió `repo_archivo_leer`. No inventes SHAs.
5. **Si no existe:** llama a `funcionalidad_crear`.
   **Si ya existe:** léela con `nota_leer` y muéstrame qué cambió respecto del código, afirmación por afirmación. Luego llama a `funcionalidad_actualizar` con su `id`, su `version` como `version_esperada` y solo los campos que cambian:
   - `afirmaciones` y `fuentes` reemplazan la tabla y la lista enteras: incluye también las que siguen vigentes.
   - Cambiar afirmaciones, fuentes o `evidence` exige `reviewed_commit`.
   - Para que deje de salir en `notas_desactualizadas`, las `fuentes` deben llevar el SHA nuevo.
   - La key no cambia; `titulo` cambia el título, no el nombre del archivo.
6. Muéstrame la vista previa completa, incluidos los avisos de bloques editados a mano, y espera mi aprobación explícita.
7. Solo si digo «aplícalo», llama a `cambio_aplicar`.
