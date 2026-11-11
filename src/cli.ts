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
import { lstatSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { exec } from "node:child_process";
import { homedir } from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listSkills, skillsDirs } from "./core/skills.ts";

const USAGE = `Ignis-CLI v${VERSION} — uso:

  ignis                    TUI interactiva
  ignis config             ver configuración
  ignis config get <clave>            leer una clave
  ignis config set <clave> <valor>    fijar una clave
  ignis run <tarea>        ejecuta una tarea con el agente (no interactivo)
  ignis eval [--live]      batería de validación (puntuación /100)
  ignis mcps               MCPs del proyecto: ver y gestionar (interactivo en TTY)
  ignis skills             skills reconocidas y usables por el agente
  ignis update             comprueba y aplica la última release de GitHub
  ignis uninstall [--yes]  borrado sano de Ignis-CLI y su configuración
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
    case "mcps":
      return cmdMcps();
    case "skills":
      return cmdSkills();
    case "update":
      return cmdUpdate();
    case "uninstall":
      return cmdUninstall(args);
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

async function cmdUninstall(args: string[]): Promise<number> {
  const force = args.includes("--yes");
  const appDir = join(process.env.HOME ?? "", ".ignis-cli");
  const bin = join(process.env.HOME ?? "", ".local", "bin", "ignis");
  const cfgDir = join(configPath(), "..");
  console.log("uninstall eliminará:");
  console.log(`  ${appDir}`);
  console.log(`  ${bin} (symlink)`);
  console.log(`  ${cfgDir} (config, prompt, plan, skills)`);
  console.log("  (.pi/ del proyecto se conserva)");
  if (!force) {
    if (!process.stdin.isTTY) {
      console.error("\nno interactivo: usa --yes para confirmar");
      return 1;
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question('\nescribe "si" para confirmar: ')).trim().toLowerCase();
    rl.close();
    if (answer !== "si") { console.log("abortado"); return 1; }
  }
  await rm(appDir, { recursive: true, force: true });
  try { if (lstatSync(bin).isSymbolicLink()) await rm(bin); } catch { /* no existía */ }
  await rm(cfgDir, { recursive: true, force: true });
  console.log("Ignis-CLI desinstalado. La db ignis_state.db de cada proyecto se conserva.");
  return 0;
}

async function cmdUpdate(): Promise<number> {
  console.log("comprobando última release…");
  let tag = "";
  try {
    const res = await fetch("https://api.github.com/repos/yosoyignicion/Ignis-CLI/releases/latest", {
      headers: { "user-agent": "ignis-cli" },
      signal: AbortSignal.timeout(6000),
    });
    tag = (await res.json() as { tag_name?: string }).tag_name ?? "";
  } catch (e) {
    console.error(`no se pudo consultar GitHub: ${e instanceof Error ? e.message : e}`);
    return 1;
  }
  if (!tag.startsWith("v")) { console.error("respuesta inesperada de GitHub"); return 1; }
  const latest = tag.slice(1);
  const cmp = compareSemver(latest, VERSION);
  if (cmp <= 0) { console.log(`ya estás en la última versión (${VERSION})`); return 0; }
  console.log(`actualizando ${VERSION} → ${tag}…`);
  await new Promise<void>((resolve, reject) => {
    exec(`curl -fsSL https://raw.githubusercontent.com/yosoyignicion/Ignis-CLI/${tag}/install.sh | sh`, (err, stdout, stderr) => {
      if (stdout) process.stdout.write(stdout);
      if (stderr) process.stderr.write(stderr);
      err ? reject(err) : resolve();
    });
  });
  console.log(`instalado ${tag}. Reinicia cualquier sesión abierta de ignis.`);
  return 0;
}

function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10));
  const pb = b.split(".").map((n) => parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return 1;
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return -1;
  }
  return 0;
}

function readMcps(): { path: string; servers: Record<string, { enabled?: boolean }> } | null {
  const path = join(process.cwd(), ".pi", "mcp.json");
  try {
    const obj = JSON.parse(readFileSync(path, "utf8")) as { mcpServers?: Record<string, { enabled?: boolean }> };
    return { path, servers: obj.mcpServers ?? {} };
  } catch {
    return null;
  }
}

function writeMcps(path: string, servers: Record<string, { enabled?: boolean }>): void {
  writeFileSync(path, JSON.stringify({ mcpServers: servers }, null, 2) + "\n");
}

function printMcps(servers: Record<string, { enabled?: boolean }>): void {
  const names = Object.keys(servers);
  if (names.length === 0) { console.log("sin MCPs configurados"); return; }
  names.forEach((n, i) => {
    const on = servers[n]?.enabled !== false;
    console.log(`  ${i + 1}. ${n}  [${on ? "habilitado" : "deshabilitado"}]`);
  });
}

async function cmdMcps(): Promise<number> {
  const mcp = readMcps();
  if (!mcp) {
    console.error(`no hay .pi/mcp.json en el proyecto (${process.cwd()})`);
    console.error("crea uno con: { \"mcpServers\": { \"<nombre>\": { \"enabled\": true } } }");
    return 1;
  }
  console.log(`MCPs en ${mcp.path}:`);
  printMcps(mcp.servers);
  if (!process.stdin.isTTY) return 0;
  console.log("\ninteractivo: <n> alternar · del <n> borrar · q salir");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  for (;;) {
    const line = (await rl.question("> ")).trim();
    if (line === "q" || line === "") { rl.close(); return 0; }
    const del = line.match(/^del\s+(\d+)$/);
    const names = Object.keys(mcp.servers);
    if (del) {
      const idx = parseInt(del[1]!, 10) - 1;
      if (idx < 0 || idx >= names.length) { console.log("índice fuera de rango"); continue; }
      delete mcp.servers[names[idx]!];
      writeMcps(mcp.path, mcp.servers);
      console.log("borrado.");
    } else if (/^\d+$/.test(line)) {
      const idx = parseInt(line, 10) - 1;
      if (idx < 0 || idx >= names.length) { console.log("índice fuera de rango"); continue; }
      const name = names[idx]!;
      const now = mcp.servers[name]?.enabled === false;
      mcp.servers[name] = { ...mcp.servers[name], enabled: now };
      writeMcps(mcp.path, mcp.servers);
      console.log(`${name} → ${now ? "habilitado" : "deshabilitado"}`);
    } else {
      console.log("uso: <n> alternar · del <n> borrar · q salir");
    }
    printMcps(mcp.servers);
  }
}

async function cmdSkills(): Promise<number> {
  const skills = await listSkills();
  if (skills.length === 0) {
    console.log("sin skills. Crea ficheros .md en:");
    for (const { dir, source } of skillsDirs()) console.log(`  ${dir}  (${source})`);
    console.log("el agente las verá listadas en su prompt y podrá leerlas con read_file.");
    return 0;
  }
  console.log(`skills activas (${skills.length}):`);
  for (const s of skills) console.log(`  ${s.name.padEnd(24)} [${s.source}] ${s.path}`);
  return 0;
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
