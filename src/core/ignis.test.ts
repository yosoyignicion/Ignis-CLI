import { test } from "node:test";
import assert from "node:assert";
import { buildContextMessages, loadContextFiles } from "./context.ts";
import { ProviderRegistry } from "./provider.ts";

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
