---
description: Cambia el estado de una tarea o incidencia con vista previa
argument-hint: <ID> <Por hacer|Pendiente|En curso|Bloqueado|Completado> [motivo o resolution]
allowed-tools: mcp__asyncdv-docs__nota_leer, mcp__asyncdv-docs__tarea_cambiar_estado, mcp__asyncdv-docs__items_listar
---
Con asyncdv-docs, cambia el estado según esto: $ARGUMENTS

Pasos:
1. Lee la nota con `nota_leer` para obtener su `version`.
2. Prepara el cambio con `tarea_cambiar_estado`, pasando esa versión como `version_esperada`. Omite `pedido_por` (el MCP usa el usuario configurado), salvo que indique otro nombre.
3. Reglas del dominio que debes respetar:
   - «Bloqueado» exige `blocked_by` o `blocked_reason`.
   - «Pendiente» y reabrir una nota «Completado» exigen `motivo`.
   - «Completado» exige `resolution` (hecha, cancelada o duplicada); «hecha» solo si no quedan criterios sin marcar.
   Si falta un dato que la regla exige, pregúntamelo en vez de inventarlo.
4. Muéstrame el diff y espera mi aprobación explícita.
5. Solo si digo «aplícalo», llama a `cambio_aplicar`. Si la herramienta responde que ya está en ese estado, dilo y no hagas nada más.
