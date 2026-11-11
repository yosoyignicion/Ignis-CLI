import { test } from "node:test";
import assert from "node:assert";
import { buildContextMessages, loadContextFiles } from "./context.ts";
import { ProviderRegistry } from "./provider.ts";
import { runAgentLoop } from "./agent-loop.ts";

test("buildContextMessages con contexto inyecta system+user", () => {
  const files = [
    { path: "/tmp/a.md", content: "ctx-a" },
    { path: "/tmp/b.md", content: "ctx-b" },
  ];
  const msgs = buildContextMessages(files, "task") as Array<{ role: string; content: string }>;
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0]!.role, "system");
  assert.ok(msgs[0]!.content.includes("ctx-a"));
  assert.equal(msgs[1]!.role, "user");
  assert.equal(msgs[1]!.content, "task");
});

test("buildContextMessages sin contexto usa system default", () => {
  const msgs = buildContextMessages([], "task") as Array<{ role: string; content: string }>;
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0]!.content, "You are Ignis-CLI.");
});

test("loadContextFiles ignora archivos inexistentes", async () => {
  const files = await loadContextFiles(["/tmp/definitely-missing-xyz.md"]);
  assert.deepEqual(files, []);
});

test("ProviderRegistry register/get/list", () => {
  const r = new ProviderRegistry();
  assert.deepEqual(r.list(), []);
  const p = { name: "mock", invoke: async () => ({ content: "x" }) };
  r.register(p);
  assert.equal(r.get("mock"), p);
  assert.throws(() => r.get("nope"), /Unknown provider/);
});

test("runAgentLoop respeta maxIterations y finaliza con agent_end (anti-bucle)", async () => {
  const provider = {
    invoke: async () => ({ content: [{ type: "toolCall", id: "c1", name: "noop", arguments: {} }], stopReason: "toolUse" }),
  };
  const result = await runAgentLoop(
    { provider, executeTool: async () => "ok", maxIterations: 2 },
    [],
  );
  assert.equal(result.iterations, 2);
  assert.equal(result.events.at(-1)?.type, "agent_end");
});

test("runAgentLoop emite agent_start una sola vez", async () => {
  const provider = { invoke: async () => ({ content: "hola", stopReason: "stop" }) };
  const result = await runAgentLoop({ provider, maxIterations: 5 }, []);
  assert.equal(result.events.filter((e) => e.type === "agent_start").length, 1);
});

test("toolset: read/write/edit roundtrip y guardas de self_edit", async () => {
  const { buildToolset, promptPath } = await import("./tools.ts");
  const ts = buildToolset();
  const file = "/tmp/opencode/ignis-toolset-test.txt";
  assert.match(await ts.execute("write_file", { path: file, content: "hola mundo" }) as string, /escrito/);
  assert.match(await ts.execute("read_file", { path: file }) as string, /hola mundo/);
  assert.match(await ts.execute("edit_file", { path: file, old_string: "mundo", new_string: "ignis" }) as string, /editado/);
  assert.match(await ts.execute("edit_file", { path: file, old_string: "no-existe", new_string: "x" }) as string, /no encontrado/);
  const tooShort = await ts.execute("self_edit", { content: "corto" });
  assert.match(tooShort as string, /demasiado corto/);
  assert.ok((promptPath() as string).endsWith("prompt.md"));
});

test("ollama: multi-captura de tool-calls volcadas en texto", async () => {
  const { parseToolCallsFromText } = await import("./ollama.ts");
  const names = new Set(["write_file", "run_cmd", "plan_write"]);
  const text = '{"name": "run_cmd", "arguments": {"cmd": "mkdir -p /tmp/x"}}\n{"name": "write_file", "arguments": {"path": "/tmp/x/a.txt", "content": "hola"}}';
  const calls = parseToolCallsFromText(text, names);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0]!.arguments, { cmd: "mkdir -p /tmp/x" });
  assert.deepEqual(calls[1]!.arguments, { path: "/tmp/x/a.txt", content: "hola" });
  // xml + fence + plano mezclados
  const mixed = '\uFFFAtool_call{"name": "plan_write", "arguments": {"content": "p"}}\uFFFB```json\n{"name": "run_cmd", "arguments": {"cmd": "ls"}}\n```';
  assert.equal(parseToolCallsFromText(mixed, names).length, 2);
});

test("ollama: mapeo de mensajes y respuestas (sin red)", async () => {
  const { toOllamaMessages, fromOllamaResponse, extractText } = await import("./ollama.ts");
  const msgs = toOllamaMessages([
    { role: "user", content: [{ type: "text", text: "tarea" }] },
    { role: "assistant", content: [{ type: "text", text: "voy" }, { type: "toolCall", id: "c1", name: "read_file", arguments: {} }], toolCalls: [{ id: "c1", type: "function", function: { name: "read_file", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "c1", content: [{ type: "text", text: "contenido" }] },
  ]);
  assert.equal(msgs[0].content, "tarea");
  assert.equal(msgs[1].tool_calls[0].function.name, "read_file");
  assert.equal(msgs[2].tool_name, "read_file");
  const resp = fromOllamaResponse({ message: { content: "hecho", tool_calls: [{ function: { name: "run_cmd", arguments: { cmd: "ls" } } }] } });
  assert.equal(extractText(resp.content), "hecho");
  assert.equal(resp.stopReason, "toolUse");
  assert.deepEqual(extractToolCallsTest(resp.content)[0], { id: "tc_1", name: "run_cmd", arguments: { cmd: "ls" } });
  // fallback: llamada emitida como texto JSON por modelos locales
  const fb = fromOllamaResponse(
    { message: { content: '```json\n{"name": "write_file", "arguments": {"path": "/tmp/x", "content": "y"}}\n```' } },
    new Set(["write_file", "run_cmd"]),
  );
  assert.equal(fb.stopReason, "toolUse");
  assert.equal(extractText(fb.content), "");
  assert.deepEqual(extractToolCallsTest(fb.content)[0], { id: "tc_0", name: "write_file", arguments: { path: "/tmp/x", content: "y" } });
  // texto JSON que no coincide con ninguna tool: permanece como texto
  const other = fromOllamaResponse({ message: { content: '{"name": "desconocida", "arguments": {}}' } }, new Set(["write_file"]));
  assert.equal(other.stopReason, "stop");
  // formato ReAct nativo de Qwen: \uFFFAtool_call...\uFFFB
  const react = fromOllamaResponse(
    { message: { content: 'pensamiento \uFFFAtool_call{"name": "list_dir", "arguments": {"path": "."}}\uFFFB' } },
    new Set(["list_dir"]),
  );
  assert.equal(react.stopReason, "toolUse");
  assert.deepEqual(extractToolCallsTest(react.content)[0], { id: "tc_0", name: "list_dir", arguments: { path: "." } });
});

function extractToolCallsTest(content: unknown): Array<{ id: string; name: string; arguments: Record<string, unknown> }> {
  return (content as Array<{ type?: string; id?: string; name?: string; arguments?: Record<string, unknown> }>)
    .filter((b) => b.type === "toolCall" && b.id && b.name)
    .map((b) => ({ id: b.id!, name: b.name!, arguments: b.arguments ?? {} }));
}
