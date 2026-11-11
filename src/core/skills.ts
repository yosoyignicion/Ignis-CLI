import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { configPath } from "./config.ts";

export type Skill = { name: string; path: string; source: string };

// Una skill es un .md con instrucciones reutilizables. Se descubren en el
// directorio de usuario (~/.config/ignis/skills) y en el del proyecto (.pi/skills).
export function skillsDirs(): Array<{ dir: string; source: string }> {
  return [
    { dir: join(configPath(), "..", "skills"), source: "usuario" },
    { dir: join(process.cwd(), ".pi", "skills"), source: "proyecto" },
  ];
}

export async function listSkills(): Promise<Skill[]> {
  const out: Skill[] = [];
  for (const { dir, source } of skillsDirs()) {
    try {
      for (const f of await readdir(dir)) {
        if (f.endsWith(".md")) {
          out.push({ name: f.replace(/\.md$/, ""), path: join(dir, f), source });
        }
      }
    } catch {
      // directorio inexistente: sin skills de esa fuente
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
