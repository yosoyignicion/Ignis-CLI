# Ignis-CLI

**Harness de agente local, minimalista, ultra-extensible, con TUI futurista.**

Construido a partir de la ingeniería inversa comparativa **Pi vs Claude Code vs Codex**, plasmado en TypeScript con **Node built-ins** (sin dependencias).

## Estado

Sprint final concluido. F1–F5 ✅ · Extras 🟡 · Docs ✅.

## Fases

- **F1** — Scaffold + SQLite (`ignis_state.db`) + árbol de sesiones.
- **F2** — LLM multi-proveedor + core loop (eventos, tool calls, anti-bule).
- **F3** — Contexto + inyección (`buildContextMessages`).
- **F4** — TUI (scaffold + frame black bg / white / scarlet + start/stop).
- **F5** — Tests/pulido (smoke, tests, perf).

## Extras

- Registry de extensiones + capability `codemode`.

## Uso

```bash
cd /home/ignicion/Agents/projects/pi-vs-claude-vs-codex/Ignis-CLI
node --experimental-strip-types src/index.ts
./bin/ignis
```

## Tests

```bash
node --experimental-strip-types --test src/core/ignis.test.ts
```

---

_Proyecto concluido._
