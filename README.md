# Ignis-CLI ⚡

**Harness de agente local, minimalista, ultra-extensible, con TUI futurista.**

Construido a partir de la ingeniería inversa comparativa **Pi vs Claude Code vs Codex**, plasmado en TypeScript con **Node built-ins** (sin dependencias).

[![Version](https://img.shields.io/badge/version-v1.0.10-blue)](https://github.com/yosoyignicion/Ignis-CLI/releases/tag/v1.0.10)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/yosoyignicion/Ignis-CLI/blob/master/LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)

## 📊 Estado del proyecto

- ✅ **F1–F5** — Sprint final concluido.
- ✅ **Extras** — Registry de extensiones + capability `codemode`.
- ✅ **v1.0.5** — TUI interactiva estilo pi + consola de comandos + config de usuario.
- ✅ **Por defecto** — `provider: ollama` · `model: qwen2.5-coder:7b` (Q4_K_M, local, tools).

## 🗺️ Fases

- **F1** — Scaffold + SQLite (`ignis_state.db`) + árbol de sesiones.
- **F2** — LLM multi-proveedor + core loop (eventos, tool calls, anti-bule).
- **F3** — Contexto + inyección (`buildContextMessages`).
- **F4** — TUI interactiva (splash, input, `/comandos`, `ctrl+p`, footer).
- **F5** — Tests/pulido (smoke, tests, perf).

## ✨ Extras

- **Registry de extensiones** con capability `codemode`: permite ejecutar JS scripts que llaman tools y modelos no-LLM (classifiers, image models).
- **Agente funcional (v1.0.6)**: `OllamaProvider` (`/api/chat`, tool calling) + agent-loop cableado a la TUI y a `ignis run`.
- **Toolset optimizado para modelo local**: `read_file`, `write_file`, `edit_file`, `list_dir`, `run_cmd` (timeout 30s, salida truncada a 3 KB), `plan_write` y `self_edit`.
- **Automejora**: el agente puede reescribir sus instrucciones propias con `self_edit` → `~/.config/ignis/prompt.md` (persiste entre sesiones; si no existe se usa el prompt default afinado para qwen2.5-coder:7b).

## 🧪 Agenticidad (v1.0.7)

- **Parser multi-formato de tool-calls**: nativo de Ollama, JSON plano, bloques ```json```, `<tool_call>` ReAct de Qwen y **multi-captura** (el 7b vuelca varias llamadas por turno; máx. 8 por turno).
- **Plan-then-execute**: tareas de +3 pasos → el agente escribe el plan (`plan_write`, fases `[ ]/[x]`) y **el controlador lo impone**: si quedan fases y el último turno ejecutó tools, reinicia el loop con un empujón.
- **Streaming token a token** en la TUI (NDJSON de `/api/chat`), contadores de tokens en el footer.
- **Contexto real**: `num_ctx: 32768` (el default de Ollama es 4096 — el modelo soporta 32k), `temperature` y `num_predict` configurables (`ignis config`).
- **Nudges de recuperación**: respuesta vacía del modelo → reintento guiado (fallo conocido de Qwen2.5-Coder con tools).
- **`ignis eval [--live]`**: batería de validación con puntuación /100 (12 comprobaciones offline+live; **100%** verificado con `qwen2.5-coder:7b` Q4_K_M).

### Limitaciones conocidas del 7b (Q4_K_M)
- El cumplimiento de instrucciones multi-restricción es variable: a veces narra en vez de llamar tools, o deja el plan sin marcar `[x]` al final. La TUI (multi-turno) lo compensa: escribe "continúa". El controlador de plan mitiga el resto.
- `qwen2.5-coder` no es un gran tool-user (documentado en ollama#19524): Ignis lo soporta con parseo defensivo + validación por nombre de tool.

## 📦 Instalación

### Requisitos

- **Node.js >= 22** (con soporte de TypeScript vía `--experimental-strip-types`).

### Instalación vía curl (recomendada)

```bash
curl -fsSL https://raw.githubusercontent.com/yosoyignicion/Ignis-CLI/v1.0.10/install.sh | sh
```

El instalador:

1. Descarga el release `v1.0.10` del repositorio.
2. Copia el código a `~/.ignis-cli/`.
3. Crea el comando `ignis` en `~/.local/bin/`.

Para instalar otra versión, cambia el valor de `REF` en `install.sh`.

### Instalación desde el repositorio

```bash
git clone https://github.com/yosoyignicion/Ignis-CLI.git
cd Ignis-CLI
```

## 🚀 Uso

### Consola de comandos

```bash
ignis                  # TUI interactiva
ignis config           # ver configuración (~/.config/ignis/config.json)
ignis config get provider
ignis config set provider ollama
ignis config set model qwen2.5-coder:7b
ignis config set effort none|low|medium|high|max
ignis models           # proveedor y modelo activos
ignis doctor           # comprobación del entorno
ignis mcps             # MCPs del proyecto: ver y gestionar (interactivo)
ignis skills           # skills reconocidas y usables por el agente
ignis update           # actualiza a la última release de GitHub
ignis uninstall [--yes] # borrado sano de Ignis-CLI y su configuración
ignis version
```

Skills: crea ficheros `.md` en `~/.config/ignis/skills/` (usuario) o `.pi/skills/` (proyecto). El agente los ve listados en su prompt y los lee con `read_file`.

Sin proveedor configurado, la TUI arranca como shell visual (`/provider`, `/model`, `/effort` dentro de la TUI también persisten en la config).

### Uso del agente

```bash
ignis run "lista los ficheros y resume el proyecto"   # one-shot, no interactivo
ignis                                                 # TUI: escribe una tarea y Enter
```

Dentro de la TUI, `self_edit` permite al agente guardar reglas aprendidas en `~/.config/ignis/prompt.md`.

### Instalación (comando global)

```bash
ignis
```

### Desarrollo (repositorio clonado)

```bash
node --experimental-strip-types src/index.ts
# o
./bin/ignis
```

## 🧪 Tests

```bash
node --experimental-strip-types --test src/core/ignis.test.ts
```

## 📄 Licencia

MIT
