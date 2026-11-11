# Ignis-CLI

**Harness de agente local, minimalista, ultra-extensible, con TUI futurista.**

Construido a partir de la ingeniería inversa comparativa **Pi vs Claude Code vs Codex**, plasmado en TypeScript con **Node built-ins** (sin dependencias).

## Estado

Sprint final concluido. F1–F5 ✅ · Extras ✅ · Pre-release `v1.0.0` ✅ · Docs ✅.

## Fases

- **F1** — Scaffold + SQLite (`ignis_state.db`) + árbol de sesiones.
- **F2** — LLM multi-proveedor + core loop (eventos, tool calls, anti-bule).
- **F3** — Contexto + inyección (`buildContextMessages`).
- **F4** — TUI (scaffold + frame black bg / white / scarlet + start/stop).
- **F5** — Tests/pulido (smoke, tests, perf).

## Extras

- Registry de extensiones + capability `codemode`.

## Instalación

### Requisitos

- Node.js >= 22 (con soporte de TypeScript vía `--experimental-strip-types`).

### Desde GitHub (curl)

```bash
curl -fsSL https://raw.githubusercontent.com/yosoyignicion/Ignis-CLI/v1.0.0/install.sh | sh
```

El instalador descarga el release `v1.0.0`, lo instala en `~/.ignis-cli/` y crea el comando `ignis` en `~/.local/bin/`.

Para instalar otra versión, cambia el valor de `REF` en `install.sh`.

### Desde el repositorio

```bash
git clone https://github.com/yosoyignicion/Ignis-CLI.git
cd Ignis-CLI
```

## Uso

Tras la instalación (comando global):

```bash
ignis
```

En desarrollo (repositorio clonado):

```bash
node --experimental-strip-types src/index.ts
# o
./bin/ignis
```

## Tests

```bash
node --experimental-strip-types --test src/core/ignis.test.ts
```

## License

MIT
