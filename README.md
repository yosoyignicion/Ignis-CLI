# Ignis-CLI ⚡

**Harness de agente local, minimalista, ultra-extensible, con TUI futurista.**

Construido a partir de la ingeniería inversa comparativa **Pi vs Claude Code vs Codex**, plasmado en TypeScript con **Node built-ins** (sin dependencias).

[![Version](https://img.shields.io/badge/version-v1.0.1-pre.1-blue)](https://github.com/yosoyignicion/Ignis-CLI/releases/tag/v1.0.1-pre.1)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/yosoyignicion/Ignis-CLI/blob/master/LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)

## 📊 Estado del proyecto

- ✅ **F1–F5** — Sprint final concluido.
- ✅ **Extras** — Registry de extensiones + capability `codemode`.
- ✅ **Pre-release** — `v1.0.0` publicada en GitHub.
- ✅ **Docs** — Este README.

## 🗺️ Fases

- **F1** — Scaffold + SQLite (`ignis_state.db`) + árbol de sesiones.
- **F2** — LLM multi-proveedor + core loop (eventos, tool calls, anti-bule).
- **F3** — Contexto + inyección (`buildContextMessages`).
- **F4** — TUI (scaffold + frame black bg / white / scarlet + start/stop).
- **F5** — Tests/pulido (smoke, tests, perf).

## ✨ Extras

- **Registry de extensiones** con capability `codemode`: permite ejecutar JS scripts que llaman tools y modelos no-LLM (classifiers, image models).

## 📦 Instalación

### Requisitos

- **Node.js >= 22** (con soporte de TypeScript vía `--experimental-strip-types`).

### Instalación vía curl (recomendada)

```bash
curl -fsSL https://raw.githubusercontent.com/yosoyignicion/Ignis-CLI/v1.0.1-pre.1/install.sh | sh
```

El instalador:

1. Descarga el release `v1.0.1-pre.1` del repositorio.
2. Copia el código a `~/.ignis-cli/`.
3. Crea el comando `ignis` en `~/.local/bin/`.

Para instalar otra versión, cambia el valor de `REF` en `install.sh`.

### Instalación desde el repositorio

```bash
git clone https://github.com/yosoyignicion/Ignis-CLI.git
cd Ignis-CLI
```

## 🚀 Uso

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
