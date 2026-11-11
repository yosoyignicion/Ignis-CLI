import type { ToolSpec } from "./agent-loop.ts";

export type ExtensionKind = "tool" | "codemode" | "mcp";

export type Extension = {
  name: string;
  kind?: ExtensionKind;
  tools?: ToolSpec[];
  description?: string;
};

export class ExtensionRegistry {
  readonly extensions = new Map<string, Extension>();

  register(extension: Extension): void {
    this.extensions.set(extension.name, extension);
  }

  get(name: string): Extension | undefined {
    return this.extensions.get(name);
  }

  list(): string[] {
    return [...this.extensions.keys()];
  }
}

export function createCodemodeExtension(): Extension {
  return {
    name: "codemode",
    kind: "codemode",
    description: "Run JS scripts that call tools and non-LLM models (classifiers, image models).",
  };
}
