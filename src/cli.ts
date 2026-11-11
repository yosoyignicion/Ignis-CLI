import { VERSION } from "./version.ts";
import { CONFIG_DEFAULTS, CONFIG_KEYS, configPath, loadConfig, setConfigValue } from "./core/config.ts";

const USAGE = `Ignis-CLI v${VERSION} — uso:

  ignis                    TUI interactiva
  ignis config             ver configuración
  ignis config get <clave>            leer una clave
  ignis config set <clave> <valor>    fijar una clave
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

function cmdDoctor(): number {
  let fail = false;
  const nodeMajor = parseInt(process.versions.node.split(".")[0]!, 10);
  if (nodeMajor >= 22) console.log(`✓ node ${process.versions.node}`);
  else { console.log(`✗ node ${process.versions.node} (se requiere >= 22 por --experimental-strip-types)`); fail = true; }
  const cfg = loadConfig();
  console.log(`✓ config ${configPath()} — provider=${cfg.provider || "(sin definir)"} model=${cfg.model || "(sin definir)"} effort=${cfg.effort}`);
  if (!cfg.provider) console.log("· sin proveedor asociado: la TUI arranca como shell visual");
  console.log(`✓ effort por defecto ${CONFIG_DEFAULTS.effort}`);
  return fail ? 1 : 0;
}

export function dispatch(cmd: string, args: string[]): number {
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
    case "models":
      return cmdModels();
    case "doctor":
      return cmdDoctor();
    default:
      console.error(`comando desconocido: ${cmd}\n\n${USAGE}`);
      return 1;
  }
}
