import type { LLMRequest, LLMResponse } from "./provider.ts";

export function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => (b as { type?: string }).type === "text")
      .map((b) => (b as { text?: string }).text ?? "")
      .join("");
  }
  return "";
}

// Convierte mensajes del loop (estilo OpenAI) al formato /api/chat de Ollama.
export function toOllamaMessages(messages: unknown[]): unknown[] {
  const toolNames = new Map<string, string>();
  const out: unknown[] = [];
  for (const raw of messages) {
    const m = raw as { role?: string; content?: unknown; toolCalls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>; tool_call_id?: string };
    if (m.role === "assistant") {
      for (const tc of m.toolCalls ?? []) {
        if (tc.id && tc.function?.name) toolNames.set(tc.id, tc.function.name);
      }
      const text = extractText(m.content);
      const toolCalls = (m.toolCalls ?? []).map((tc) => ({
        function: {
          name: tc.function?.name ?? "",
          arguments: (() => { try { return JSON.parse(tc.function?.arguments || "{}"); } catch { return {}; } })(),
        },
      }));
      out.push({ role: "assistant", content: text, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) });
    } else if (m.role === "tool") {
      out.push({ role: "tool", content: extractText(m.content), tool_name: toolNames.get(m.tool_call_id ?? "") ?? "" });
    } else {
      out.push({ role: m.role === "system" ? "system" : "user", content: extractText(m.content) });
    }
  }
  return out;
}

// Fallback para modelos locales que emiten la tool-call como texto JSON en vez de tool_calls.
function tryParseToolCall(content: string, toolNames: Set<string>): { name: string; arguments: unknown } | null {
  let s = content.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  if (!s.startsWith("{")) return null;
  try {
    const obj = JSON.parse(s) as { name?: unknown; arguments?: unknown };
    if (typeof obj.name === "string" && toolNames.has(obj.name) && obj.arguments !== undefined) {
      const args = typeof obj.arguments === "string" ? JSON.parse(obj.arguments) : obj.arguments;
      return { name: obj.name, arguments: args };
    }
  } catch {
    // JSON parcial o inválido: se deja como texto y el modelo se autocorrige en el siguiente turno
  }
  return null;
}

// Convierte la respuesta de Ollama al formato del loop ({content: bloques, stopReason}).
export function fromOllamaResponse(raw: { message?: { content?: string; tool_calls?: Array<{ function?: { name?: string; arguments?: unknown } }> } }, toolNames: Set<string> = new Set()): LLMResponse {
  const msg = raw.message ?? {};
  const native = msg.tool_calls ?? [];
  let blocks: Array<{ type: string; text?: string; id?: string; name?: string; arguments?: unknown }> = [{ type: "text", text: msg.content ?? "" }];
  if (native.length > 0) {
    for (const tc of native) {
      blocks.push({ type: "toolCall", id: `tc_${blocks.length}`, name: tc.function?.name ?? "", arguments: tc.function?.arguments ?? {} });
    }
  } else if (toolNames.size > 0) {
    const parsed = tryParseToolCall(msg.content ?? "", toolNames);
    if (parsed) blocks = [{ type: "toolCall", id: "tc_0", name: parsed.name, arguments: parsed.arguments }];
  }
  const hasCall = blocks.some((b) => b.type === "toolCall");
  return { content: blocks, stopReason: hasCall ? "toolUse" : "stop" };
}

export class OllamaProvider {
  readonly name = "ollama";
  private readonly host: string;
  private readonly model: string;

  constructor(host: string, model: string) {
    this.host = host.replace(/\/$/, "");
    this.model = model;
  }

  async invoke(req: LLMRequest): Promise<LLMResponse> {
    const model = req.model && req.model !== "ignis-default" ? req.model : this.model;
    const tools = req.tools?.length
      ? (req.tools as Array<{ name: string; description?: string; inputSchema?: unknown }>).map((t) => ({
          type: "function",
          function: { name: t.name, description: t.description ?? "", parameters: t.inputSchema ?? { type: "object", properties: {} } },
        }))
      : undefined;
    const res = await fetch(`${this.host}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, messages: toOllamaMessages(req.messages), tools, stream: false }),
      signal: req.signal,
    });
    if (!res.ok) throw new Error(`ollama ${res.status}: ${await res.text()}`);
    const toolNames = new Set((req.tools as Array<{ name?: string }> ?? []).map((t) => t.name ?? "").filter(Boolean));
    return fromOllamaResponse(await res.json(), toolNames);
  }
}
