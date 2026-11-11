import { exec } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { configPath } from "./config.ts";
import type { ToolSpec } from "./agent-loop.ts";

const MAX_OUT = 3000;
const MAX_PROMPT = 8000;

function trunc(s: string, max = MAX_OUT): string {
  return s.length <= max ? s : s.slice(0, max) + `\n… (${s.length - max} caracteres recortados)`;
}

function argStr(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  return typeof v === "string" ? v : "";
}

export function promptPath(): string {
  return join(configPath(), "..", "prompt.md");
}

export function planPath(): string {
  return join(configPath(), "..", "plan.md");
}

type Tool = {
  spec: ToolSpec;
  run: (args: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>;
};

const read_file: Tool = {
  spec: {
    name: "read_file",
    description: "lee un fichero de texto. Opcional: offset (línea inicial 1-based), limit (líneas).",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" }, offset: { type: "integer" }, limit: { type: "integer" } },
      required: ["path"],
    },
  },
  run: async (args) => {
    const path = argStr(args, "path");
    const data = await readFile(path, "utf8");
    const offset = typeof args.offset === "number" && args.offset > 1 ? args.offset - 1 : 0;
    const limit = typeof args.limit === "number" && args.limit > 0 ? args.limit : 120;
    return trunc(data.split("\n").slice(offset, offset + limit).join("\n"));
  },
};

const write_file: Tool = {
  spec: {
    name: "write_file",
    description: "crea o sobrescribe un fichero con el contenido dado.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
    },
  },
  run: async (args) => {
    await writeFile(argStr(args, "path"), argStr(args, "content"));
    return `escrito ${argStr(args, "path")}`;
  },
};

const edit_file: Tool = {
  spec: {
    name: "edit_file",
    description: "reemplazo exacto y único en un fichero: old_string debe aparecer una sola vez.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" }, old_string: { type: "string" }, new_string: { type: "string" } },
      required: ["path", "old_string", "new_string"],
    },
  },
  run: async (args) => {
    const path = argStr(args, "path");
    const old = argStr(args, "old_string");
    const data = await readFile(path, "utf8");
    const count = data.split(old).length - 1;
    if (count === 0) return `error: old_string no encontrado en ${path}`;
    if (count > 1) return `error: old_string aparece ${count} veces en ${path}; incluye más contexto`;
    await writeFile(path, data.replace(old, argStr(args, "new_string")));
    return `editado ${path}`;
  },
};

const list_dir: Tool = {
  spec: {
    name: "list_dir",
    description: "lista entradas de un directorio (por defecto el cwd).",
    inputSchema: { type: "object", properties: { path: { type: "string" } } },
  },
  run: async (args) => {
    const entries = await readdir(argStr(args, "path") || process.cwd(), { withFileTypes: true });
    return trunc(entries.map((e) => `${e.isDirectory() ? "d" : "-"} ${e.name}`).join("\n"));
  },
};

const run_cmd: Tool = {
  spec: {
    name: "run_cmd",
    description: "ejecuta un comando shell (idempotente y no interactivo). Timeout 30s por defecto.",
    inputSchema: {
      type: "object",
      properties: { cmd: { type: "string" }, timeout_ms: { type: "integer" } },
      required: ["cmd"],
    },
  },
  run: (args, signal) =>
    new Promise((resolve) => {
      exec(argStr(args, "cmd"), {
        cwd: process.cwd(),
        timeout: typeof args.timeout_ms === "number" ? args.timeout_ms : 30000,
        maxBuffer: 2 * 1024 * 1024,
        killSignal: "SIGKILL",
        signal,
      }, (err, stdout, stderr) => {
        const out = [stdout?.toString(), stderr?.toString()].filter(Boolean).join("\n");
        resolve(trunc(err && !out ? `error (${err.message.split("\n")[0]})` : out || "(sin salida)"));
      });
    }),
};

// Automejora: el agente puede reescribir sus propias instrucciones persistentes.
const self_edit: Tool = {
  spec: {
    name: "self_edit",
    description: "reescribe tus instrucciones propias (~/.config/ignis/prompt.md). Antes: lee el fichero actual con read_file y devuelve el prompt COMPLETO (reglas vigentes + la nueva), nunca solo la regla nueva. Solo reglas comprobadas.",
    inputSchema: {
      type: "object",
      properties: { content: { type: "string" } },
      required: ["content"],
    },
  },
  run: async (args) => {
    const content = argStr(args, "content");
    if (content.length > MAX_PROMPT) return `error: contenido demasiado largo (${content.length} > ${MAX_PROMPT})`;
    if (content.length < 40) return "error: prompt demasiado corto para ser útil";
    await writeFile(promptPath(), content);
    return `prompt propio actualizado (${content.length} caracteres)`;
  },
};

// Plan-then-execute: el plan persistido mantiene el foco del modelo aunque el contexto crezca.
const plan_write: Tool = {
  spec: {
    name: "plan_write",
    description: "crea o actualiza el plan de la tarea (~/.config/ignis/plan.md): fases numeradas con [ ] pendiente / [x] hecha. Obligatorio para tareas de más de 3 pasos: planifica primero y ejecuta fase a fase, actualizando el plan al completar cada una.",
    inputSchema: {
      type: "object",
      properties: { content: { type: "string" } },
      required: ["content"],
    },
  },
  run: async (args) => {
    const content = argStr(args, "content");
    if (content.length > 4000) return `error: plan demasiado largo (${content.length} > 4000)`;
    await writeFile(planPath(), content);
    return "plan actualizado";
  },
};

const TOOLS = [read_file, write_file, edit_file, list_dir, run_cmd, plan_write, self_edit];

export function buildToolset(): {
  tools: ToolSpec[];
  execute: (name: string, args: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>;
} {
  const byName = new Map(TOOLS.map((t) => [t.spec.name, t]));
  return {
    tools: TOOLS.map((t) => t.spec),
    execute: async (name, args, signal) => {
      const tool = byName.get(name);
      if (!tool) return `error: tool desconocida ${name}`;
      try {
        return await tool.run(args, signal);
      } catch (e) {
        return `error: ${e instanceof Error ? e.message : String(e)}`;
      }
    },
  };
}
