import { VERSION } from "./version.ts";
import { CONFIG_DEFAULTS, CONFIG_KEYS, configPath, loadConfig, setConfigValue } from "./core/config.ts";
import { OllamaProvider, extractText } from "./core/ollama.ts";
import { buildToolset } from "./core/tools.ts";
import { loadPrompt } from "./core/prompt.ts";
import { runAgentLoop } from "./core/agent-loop.ts";
import { runWithPlanContinuation } from "./core/agent-plan.ts";

import { toOllamaMessages, fromOllamaResponse } from "./core/ollama.ts";
import { renderStatic } from "./tui/tui.ts";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const USAGE = `Ignis-CLI v${VERSION} — uso:

  ignis                    TUI interactiva
  ignis config             ver configuración
  ignis config get <clave>            leer una clave
  ignis config set <clave> <valor>    fijar una clave
  ignis run <tarea>        ejecuta una tarea con el agente (no interactivo)
  ignis eval [--live]      batería de validación (puntuación /100)
  ignis models             proveedor y modelo activos
  ignis doctor             comprobación del entorno
  ignis help [comando]     esta ayuda
  ignis version            versión

Claves de config: ${CONFIG_KEYS.join(", ")}

Sin proveedor configurado, la TUI funciona como shell visual.
Ejemplo (Ollama local):
  ignis config set provider ollama
  ignis config set model qwen2.5-coder:7b
`;

function cmdConfig(args: string[]): number {
  if (args.length === 0) {
    const cfg = loadConfig();
    console.log(`config: ${configPath()}`);
    for (const key of CONFIG_KEYS) {
      console.log(`  ${key.padEnd(10)} ${cfg[key] === "" ? "(sin definir)" : cfg[key]}`);
    }
    return 0;
  }
  const [op, key, ...value] = args;
  if (op === "get") {
    if (!key || !(CONFIG_KEYS as string[]).includes(key)) {
      console.error(`uso: ignis config get <clave> — claves: ${CONFIG_KEYS.join(", ")}`);
      return 1;
    }
    const cfg = loadConfig();
    console.log(cfg[key as keyof typeof CONFIG_DEFAULTS]);
    return 0;
  }
  if (op === "set") {
    if (!key || value.length === 0) {
      console.error("uso: ignis config set <clave> <valor>");
      return 1;
    }
    const res = setConfigValue(key, value.join(" "));
    if (res.ok) { console.log(`${key} → ${value.join(" ")}`); return 0; }
    console.error(res.error);
    return 1;
  }
  console.error(`uso: ignis config [get|set]\n\n${USAGE}`);
  return 1;
}

function cmdModels(): number {
  const cfg = loadConfig();
  if (!cfg.provider) {
    console.log("sin proveedor configurado (config: " + configPath() + ")");
    console.log("fíjalo con: ignis config set provider ollama && ignis config set model <modelo>");
    return 0;
  }
  console.log(`provider: ${cfg.provider}`);
  console.log(`model:    ${cfg.model || "(sin definir)"}`);
  console.log(`host:     ${cfg.host}`);
  return 0;
}

async function cmdDoctor(): Promise<number> {
  let fail = false;
  const nodeMajor = parseInt(process.versions.node.split(".")[0]!, 10);
  if (nodeMajor >= 22) console.log(`✓ node ${process.versions.node}`);
  else { console.log(`✗ node ${process.versions.node} (se requiere >= 22 por --experimental-strip-types)`); fail = true; }
  const cfg = loadConfig();
  console.log(`✓ config ${configPath()} — provider=${cfg.provider || "(sin definir)"} model=${cfg.model || "(sin definir)"} effort=${cfg.effort}`);
  if (cfg.provider === "ollama") {
    try {
      const res = await fetch(`${cfg.host.replace(/\/$/, "")}/api/tags`, { signal: AbortSignal.timeout(2500) });
      const models = (await res.json() as { models?: Array<{ name?: string }> }).models ?? [];
      const found = models.some((m) => m.name === cfg.model);
      console.log(`${found ? "✓" : "·"} ollama ${cfg.host} — modelo ${cfg.model} ${found ? "disponible" : "no está en la lista de ollama (ollama pull " + cfg.model + ")"}`);
    } catch {
      console.log(`✗ ollama no responde en ${cfg.host}`);
      fail = true;
    }
  } else if (!cfg.provider) {
    console.log("· sin proveedor asociado: la TUI arranca como shell visual");
  }
  console.log(`✓ effort por defecto ${CONFIG_DEFAULTS.effort}`);
  return fail ? 1 : 0;
}

export async function dispatch(cmd: string, args: string[]): Promise<number> {
  switch (cmd) {
    case "help":
    case "--help":
    case "-h":
      console.log(USAGE);
      return 0;
    case "version":
    case "--version":
    case "-v":
      console.log(VERSION);
      return 0;
    case "config":
      return cmdConfig(args);
    case "run":
      return cmdRun(args);
    case "eval":
      return cmdEval(args);
    case "models":
      return cmdModels();
    case "doctor":
      return cmdDoctor();
    default:
      console.error(`comando desconocido: ${cmd}\n\n${USAGE}`);
      return 1;
  }
}

async function cmdEval(args: string[]): Promise<number> {
  const live = args.includes("--live");
  const checks: Array<{ name: string; run: () => Promise<boolean> | boolean }> = [];
  const add = (name: string, run: () => Promise<boolean> | boolean) => checks.push({ name, run });

  add("node >= 22", () => parseInt(process.versions.node.split(".")[0]!, 10) >= 22);
  add("config legible con claves completas", () => {
    const cfg = loadConfig();
    return CONFIG_KEYS.every((k) => k in cfg);
  });
  add("toolset: write/read/edit roundtrip", async () => {
    const ts = buildToolset();
    const dir = await mkdtemp(join(tmpdir(), "ignis-eval-"));
    const file = join(dir, "x.txt");
    const okWrite = /escrito/.test(String(await ts.execute("write_file", { path: file, content: "abc" })));
    const okRead = /abc/.test(String(await ts.execute("read_file", { path: file })));
    const okEdit = /editado/.test(String(await ts.execute("edit_file", { path: file, old_string: "abc", new_string: "xyz" })));
    await rm(dir, { recursive: true, force: true });
    return okWrite && okRead && okEdit;
  });
  add("toolset: guardas de self_edit", async () => {
    const ts = buildToolset();
    return /demasiado corto/.test(String(await ts.execute("self_edit", { content: "corto" })));
  });
  add("ollama: parse JSON-texto (fallback)", () => {
    const r = fromOllamaResponse({ message: { content: '{"name": "run_cmd", "arguments": {"cmd": "ls"}}' } }, new Set(["run_cmd"]));
    return r.stopReason === "toolUse";
  });
  add("ollama: parse formato ReAct Qwen", () => {
    const r = fromOllamaResponse({ message: { content: 'text antes \uFFFAtool_call{"name": "read_file", "arguments": {"path": "/a"}}\uFFFB' } }, new Set(["read_file"]));
    return r.stopReason === "toolUse";
  });
  add("ollama: mapeo de mensajes", () => {
    const msgs = toOllamaMessages([{ role: "user", content: [{ type: "text", text: "hola" }] }]);
    return (msgs[0] as { content: string }).content === "hola";
  });
  add("TUI: renderStatic produce frame", () => renderStatic({ messages: [], model: "m", provider: "p", effort: "high" }).length > 200);
  add("agent-loop: anti-bucle (mock)", async () => {
    const provider = { invoke: async () => ({ content: [{ type: "toolCall", id: "c", name: "noop", arguments: {} }], stopReason: "toolUse" }) };
    const r = await runAgentLoop({ provider, executeTool: async () => "ok", maxIterations: 2 }, []);
    return r.iterations === 2 && r.events.at(-1)?.type === "agent_end";
  });
  if (live) {
    const cfg = loadConfig();
    add("live: ollama responde con el modelo", async () => {
      if (cfg.provider !== "ollama" || !cfg.model) return false;
      try {
        const res = await fetch(`${cfg.host.replace(/\/$/, "")}/api/tags`, { signal: AbortSignal.timeout(2500) });
        return ((await res.json() as { models?: Array<{ name?: string }> }).models ?? []).some((m) => m.name === cfg.model);
      } catch { return false; }
    });
    add("live: respuesta simple del modelo", () => {
      if (cfg.provider !== "ollama" || !cfg.model) return false;
      const p = new OllamaProvider(cfg.host, cfg.model, 0, Number(cfg.num_ctx) || 32768);
      return p.invoke({ model: cfg.model, messages: [{ role: "user", content: "Responde exactamente OK" }] })
        .then((r) => extractText(r.content).includes("OK")).catch(() => false);
    });
    add("live: ciclo de tool real (echo)", () => {
      if (cfg.provider !== "ollama" || !cfg.model) return false;
      const ts = buildToolset();
      const p = new OllamaProvider(cfg.host, cfg.model, 0, Number(cfg.num_ctx) || 32768);
      return runAgentLoop({
        provider: p, model: cfg.model, tools: ts.tools, maxIterations: 4, executeTool: ts.execute,
      }, [
        { role: "system", content: "Usa exactamente una tool y luego responde." },
        { role: "user", content: 'Ejecuta run_cmd con cmd "echo ignis-eval-ok" y reporta la salida.' },
      ]).then((r) => r.messages.some((m) => String(extractText((m as { content?: unknown }).content)).includes("ignis-eval-ok"))).catch(() => false);
    });
  }

  let passed = 0;
  const results: Array<{ name: string; ok: boolean }> = [];
  for (const c of checks) {
    let ok = false;
    try { ok = await c.run(); } catch { ok = false; }
    if (ok) passed += 1;
    results.push({ name: c.name, ok });
  }
  console.log("\nBatería de validación Ignis-CLI v" + VERSION);
  for (const r of results) console.log(`  ${r.ok ? "✓" : "✗"} ${r.name}`);
  const score = Math.round((passed / checks.length) * 100);
  console.log(`\n  ${passed}/${checks.length} comprobaciones — ${score}%`);
  if (!live) console.log("  (usa --live para incluir comprobaciones con el modelo real)\n");
  else console.log("");
  return score === 100 ? 0 : 1;
}

async function cmdRun(args: string[]): Promise<number> {
  const task = args.join(" ").trim();
  if (!task) {
    console.error("uso: ignis run <tarea>");
    return 1;
  }
  const cfg = loadConfig();
  if (cfg.provider !== "ollama" || !cfg.model) {
    console.error("sin proveedor activo: ignis config set provider ollama && ignis config set model <modelo>");
    return 1;
  }
  const provider = new OllamaProvider(cfg.host, cfg.model, Number(cfg.temperature) || 0.7, Number(cfg.num_ctx) || 32768);
  const toolset = buildToolset();
  let status = "";
  const { runs } = await runWithPlanContinuation(
    {
      provider,
      model: cfg.model,
      tools: toolset.tools,
      maxIterations: 12,
      executeTool: toolset.execute,
      onEvent: (ev) => {
        if (ev.type === "tool_execution_start") status = `· ${ev.toolName}`;
        if (ev.type === "message_end") {
          const m = ev.message as { role?: string; content?: unknown };
          if (m.role === "assistant") {
            const t = extractText(m.content).trim();
            if (t) {
              if (status) console.error(status);
              console.log(t);
            }
          }
        }
      },
    },
    [
      { role: "system", content: await loadPrompt() },
      { role: "user", content: task },
    ],
  );
  console.error(`fin: ${runs.reduce((n, r) => n + r.iterations, 0)} iteración(es)`);
  return 0;
}
