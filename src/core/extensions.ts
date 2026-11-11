import type { ToolSpec } from "./agent-loop.ts";

export type Extension = {
  name: string;
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
