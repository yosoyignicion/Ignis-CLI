import { readFile } from "node:fs/promises";

export interface ContextFile {
  path: string;
  content: string;
}

export async function loadContextFiles(paths: string[]): Promise<ContextFile[]> {
  const files: ContextFile[] = [];
  for (const path of paths) {
    try {
      const content = await readFile(path, "utf8");
      files.push({ path, content });
    } catch {
      // Archivo inexistente: se ignora (solo se cargan los que existen).
    }
  }
  return files;
}

export function buildContextMessages(files: ContextFile[], task: string): unknown[] {
  const instructions = files.map((f) => `## Context: ${f.path}\n${f.content}`).join("\n\n");
  const systemMessage = {
    role: "system",
    content: instructions ? `You are Ignis-CLI. Project context:\n${instructions}` : "You are Ignis-CLI.",
  };
  const userMessage = { role: "user", content: task };
  return [systemMessage, userMessage];
}
