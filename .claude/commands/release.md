---
description: Propone la versión y el tag del proyecto (solo texto, no crea tags)
argument-hint: [rama o commit; por defecto, la rama principal configurada]
allowed-tools: mcp__asyncdv-docs__release_proponer, mcp__asyncdv-docs__repo_git_resumen
---
Con asyncdv-docs, propón el release del proyecto sobre: $ARGUMENTS (si no escribí nada, no pases `head`: se usa la rama principal configurada)

1. Llama a `release_proponer` y a `repo_git_resumen`.
2. Explícame las señales que justifican el bump, la divergencia entre la rama principal y la de desarrollo (si está configurada) y la lista de verificación previa al tag.
3. Recuerda que el MCP nunca crea ni mueve tags: los comandos `git tag` y `git push` los ejecuto yo, después de completar la lista.
4. No guardes ningún borrador a menos que te lo pida.
