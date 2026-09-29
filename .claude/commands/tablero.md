---
description: Regenera el tablero (Tablero.md) con vista previa
allowed-tools: mcp__asyncdv-docs__tablero_regenerar
---
Con asyncdv-docs, regenera el tablero.

1. Llama a `tablero_regenerar`. No escribe nada.
2. Si responde que ya está al día, dilo y termina.
3. Si devuelve una vista previa, muéstramela completa. Si trae la advertencia de que el bloque fue editado a mano, resáltala: al aplicar se pierden esos cambios.
4. Espera mi aprobación explícita. Solo si digo «aplícalo», llama a `cambio_aplicar`.
