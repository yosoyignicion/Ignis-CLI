import { ProviderRegistry } from "./provider.ts";
import { runAgentLoop } from "./agent-loop.ts";

const registry = new ProviderRegistry();
const calls: unknown[][] = [];

registry.register({
  name: "mock",
  async invoke(req: { messages: unknown[] }) {
    calls.push(req.messages);
    if (calls.length === 1) {
      return { content: [{ type: "toolCall", id: "call_1", name: "read_file", arguments: { path: "/tmp/x" } }], stopReason: "toolUse" };
    }
    return { content: [{ type: "text", text: "done" }], stopReason: "stop" };
  },
});

let executed: Array<{ name: string; args: Record<string, unknown> }> = [];
const result = await runAgentLoop(
  {
    provider: { invoke: async (req: { messages: unknown[] }) => registry.get("mock").invoke(req) },
    executeTool: async (name: string, args: Record<string, unknown>) => {
      executed.push({ name, args });
      return "file-content";
    },
    maxIterations: 10,
  },
  [],
);

console.log("RESULT", JSON.stringify({ iterations: result.iterations, events: result.events.map((e) => e.type) }));
console.log("EXECUTED", JSON.stringify(executed));
if (result.iterations < 1) throw new Error("loop did not run");
if (result.events.at(-1)?.type !== "agent_end") throw new Error("missing agent_end");
if (executed.length !== 1) throw new Error("tool not executed");
console.log("SMOKE_OK");
