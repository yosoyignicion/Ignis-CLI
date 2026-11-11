import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type IgnisConfig = {
  provider: string;
  model: string;
  effort: string;
  host: string;
};

export const CONFIG_DEFAULTS: IgnisConfig = {
  provider: "",
  model: "",
  effort: "high",
  host: "http://localhost:11434",
};

export const CONFIG_KEYS = Object.keys(CONFIG_DEFAULTS) as Array<keyof IgnisConfig>;

export function configPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(xdg, "ignis", "config.json");
}

export function loadConfig(): IgnisConfig {
  try {
    return { ...CONFIG_DEFAULTS, ...JSON.parse(readFileSync(configPath(), "utf8")) };
  } catch {
    return { ...CONFIG_DEFAULTS };
  }
}

export function saveConfig(cfg: IgnisConfig): void {
  const path = configPath();
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(cfg, null, 2) + "\n");
}

export function setConfigValue(key: string, value: string): { ok: boolean; error?: string } {
  if (!(CONFIG_KEYS as string[]).includes(key)) {
    return { ok: false, error: `clave desconocida: ${key} (válidas: ${CONFIG_KEYS.join(", ")})` };
  }
  if (key === "effort" && !["low", "medium", "high"].includes(value)) {
    return { ok: false, error: "effort debe ser low|medium|high" };
  }
  const cfg = loadConfig();
  (cfg as unknown as Record<string, string>)[key] = value;
  saveConfig(cfg);
  return { ok: true };
}
