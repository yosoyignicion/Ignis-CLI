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

// Fallback para modelos locales que emiten tool-calls como texto: captura todas las llamadas
// (formato ReAct Qwen, bloques ```json``` y objetos planos {"name": ..., "arguments": {...}}).
export function parseToolCallsFromText(content: string, toolNames: Set<string>): Array<{ name: string; arguments: unknown }> {
  const found: Array<{ name: string; arguments: unknown }> = [];
  const push = (raw: string): void => {
    try {
      const obj = JSON.parse(raw) as { name?: unknown; arguments?: unknown };
      if (typeof obj.name === "string" && toolNames.has(obj.name) && obj.arguments !== undefined) {
        const args = typeof obj.arguments === "string" ? JSON.parse(obj.arguments) : obj.arguments;
        const key = obj.name + JSON.stringify(args);
        if (!found.some((c) => c.name + JSON.stringify(c.arguments) === key)) found.push({ name: obj.name, arguments: args });
      }
    } catch {
      // fragmento no-JSON: ignorado
    }
  };
  const xmlRe = new RegExp("\\uFFFAtool_call\\s*([\\s\\S]*?)\\s*\\uFFFB", "g");
  let m: RegExpExecArray | null;
  let rest = content;
  while ((m = xmlRe.exec(content)) !== null) {
    push(m[1]!.trim());
    rest = rest.replace(m[0], "");
  }
  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/g;
  while ((m = fenceRe.exec(rest)) !== null) {
    push(m[1]!.trim());
    rest = rest.replace(m[0], "");
  }
  // objetos planos con hasta un nivel de anidación en arguments
  const flatRe = /\{\s*"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:\s*\{(?:[^{}]|\{[^{}]*\})*\}\s*\}/g;
  while ((m = flatRe.exec(rest)) !== null) push(m[0]);
  return found.slice(0, 8); // total control: máximo 8 llamadas por turno
}

function tryParseToolCall(content: string, toolNames: Set<string>): { name: string; arguments: unknown } | null {
  const calls = parseToolCallsFromText(content, toolNames);
  return calls.length > 0 ? calls[0]! : null;
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
    const calls = parseToolCallsFromText(msg.content ?? "", toolNames);
    if (calls.length > 0) {
      blocks = calls.map((c, i) => ({ type: "toolCall", id: `tc_${i}`, name: c.name, arguments: c.arguments }));
    }
  }
  const hasCall = blocks.some((b) => b.type === "toolCall");
  return { content: blocks, stopReason: hasCall ? "toolUse" : "stop" };
}

export class OllamaProvider {
  readonly name = "ollama";
  private readonly host: string;
  private readonly model: string;
  private readonly temperature: number;
  private readonly numCtx: number;
  /** contadores acumulados de tokens (para el footer) */
  promptTokens = 0;
  evalTokens = 0;

  constructor(host: string, model: string, temperature = 0.7, numCtx = 32768) {
    this.host = host.replace(/\/$/, "");
    this.model = model;
    this.temperature = temperature;
    this.numCtx = numCtx;
  }

  async invoke(req: LLMRequest): Promise<LLMResponse> {
    const model = req.model && req.model !== "ignis-default" ? req.model : this.model;
    const onToken = (req as { onToken?: (t: string) => void }).onToken;
    const toolNames = new Set((req.tools as Array<{ name?: string }> ?? []).map((t) => t.name ?? "").filter(Boolean));
    const tools = toolNames.size
      ? (req.tools as Array<{ name: string; description?: string; inputSchema?: unknown }>).map((t) => ({
          type: "function",
          function: { name: t.name, description: t.description ?? "", parameters: t.inputSchema ?? { type: "object", properties: {} } },
        }))
      : undefined;
    // num_ctx ampliado (el default de ollama es 4096) y num_predict acotado contra bucles
    const body: Record<string, unknown> = {
      model,
      messages: toOllamaMessages(req.messages),
      tools,
      stream: Boolean(onToken),
      options: { temperature: this.temperature, num_ctx: this.numCtx, num_predict: 1024 },
    };
    const res = await fetch(`${this.host}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: req.signal,
    });
    if (!res.ok) throw new Error(`ollama ${res.status}: ${await res.text()}`);
    if (!onToken) {
      const raw = await res.json() as { message?: { content?: string; tool_calls?: Array<{ function?: { name?: string; arguments?: unknown } }> }; prompt_eval_count?: number; eval_count?: number };
      this.promptTokens += raw.prompt_eval_count ?? 0;
      this.evalTokens += raw.eval_count ?? 0;
      return fromOllamaResponse(raw, toolNames);
    }
    // streaming NDJSON: tokens al vuelo, tool_calls y métricas al final
    const reader = res.body?.getReader();
    if (!reader) throw new Error("ollama: streaming no disponible");
    const dec = new TextDecoder();
    let buf = "";
    let text = "";
    let toolCalls: Array<{ function?: { name?: string; arguments?: unknown } }> = [];
    let promptEval = 0;
    let evalCount = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let chunk: { message?: { content?: string; tool_calls?: typeof toolCalls }; done?: boolean; prompt_eval_count?: number; eval_count?: number };
        try { chunk = JSON.parse(line); } catch { continue; }
        const tok = chunk.message?.content ?? "";
        if (tok) { text += tok; onToken(tok); }
        if (chunk.message?.tool_calls) toolCalls = toolCalls.concat(chunk.message.tool_calls);
        if (chunk.done) { promptEval = chunk.prompt_eval_count ?? 0; evalCount = chunk.eval_count ?? 0; }
      }
    }
    this.promptTokens += promptEval;
    this.evalTokens += evalCount;
    return fromOllamaResponse({ message: { content: text, tool_calls: toolCalls } }, toolNames);
  }
}
