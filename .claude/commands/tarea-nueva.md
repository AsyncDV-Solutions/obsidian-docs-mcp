---
description: Prepara una tarea nueva con vista previa (no escribe hasta que apruebes)
argument-hint: <título> | <descripción> | <criterio 1>; <criterio 2> | <P0-P3>
allowed-tools: mcp__asyncdv-docs__tarea_crear, mcp__asyncdv-docs__notas_buscar
---
Con asyncdv-docs, prepara una tarea a partir de estos datos: $ARGUMENTS

Los datos vienen separados por «|» en este orden: título, descripción, criterios de aceptación (separados por «;») y prioridad. Si falta alguno, pregúntamelo antes de llamar a la herramienta. Omite `pedido_por` (el MCP usa el usuario configurado), salvo que indique otro nombre.

Reglas:
1. Antes de preparar, busca con `notas_buscar` si ya existe una tarea con un título parecido y avísame.
2. Llama a `tarea_crear`. No escribe nada: solo devuelve la vista previa.
3. Muéstrame la vista previa completa y espera mi aprobación explícita.
4. Solo si digo «aplícalo», llama a `cambio_aplicar` con el código que te dieron. Nunca lo llames por tu cuenta.
