export type AgentEvent =
  | { type: "agent_start" }
  | { type: "turn_start" }
  | { type: "message_start"; message: unknown }
  | { type: "message_end"; message: unknown }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool_execution_end"; toolCallId: string; toolName: string; result: unknown; isError: boolean }
  | { type: "turn_end"; message: unknown; toolResults: unknown[] }
  | { type: "agent_end"; messages: unknown[] };

export interface ToolSpec {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface AgentLoopOptions {
  provider: { invoke: (req: unknown) => Promise<unknown> };
  tools?: ToolSpec[];
  maxIterations?: number;
  signal?: AbortSignal;
  onEvent?: (event: AgentEvent) => void | Promise<void>;
  executeTool?: (name: string, args: Record<string, unknown>) => Promise<unknown>;
}

export interface AgentLoopResult {
  messages: unknown[];
  iterations: number;
  events: AgentEvent[];
}

function extractToolCalls(content: unknown): Array<{ id: string; name: string; arguments: Record<string, unknown> }> {
  const blocks = Array.isArray(content) ? content : ((content as { content?: Array<{ type?: string; text?: string; id?: string; name?: string; arguments?: Record<string, unknown> }> }).content ?? []);
  const toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];
  for (const block of blocks) {
    if (block?.type === "toolCall" && block.id && block.name) {
      toolCalls.push({ id: block.id, name: block.name, arguments: (block.arguments ?? {}) as Record<string, unknown> });
    }
  }
  return toolCalls;
}

export async function runAgentLoop(
  opts: AgentLoopOptions,
  initialMessages: unknown[] = [],
): Promise<AgentLoopResult> {
  const maxIterations = opts.maxIterations ?? 50;
  const events: AgentEvent[] = [];
  const emit = async (event: AgentEvent) => {
    events.push(event);
    await opts.onEvent?.(event);
  };

  const messages: unknown[] = [...initialMessages];
  const newMessages: unknown[] = [];
  let iterations = 0;

  for (let i = 0; i < maxIterations; i++) {
    iterations += 1;
    await emit({ type: "agent_start" });
    await emit({ type: "turn_start" });

    const response = await opts.provider.invoke({ model: "ignis-default", messages });
    const assistantMessage = {
      role: "assistant",
      content: response.content,
      stopReason: response.stopReason ?? "stop",
    };
    messages.push(assistantMessage);
    newMessages.push(assistantMessage);
    await emit({ type: "message_start", message: assistantMessage });
    await emit({ type: "message_end", message: assistantMessage });
    await emit({ type: "turn_end", message: assistantMessage, toolResults: [] });

    const toolCalls = extractToolCalls(response.content);
    if (toolCalls.length === 0) {
      await emit({ type: "agent_end", messages: newMessages });
      break;
    }

    for (const toolCall of toolCalls) {
      await emit({
        type: "tool_execution_start",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        args: toolCall.arguments,
      });
      const result = await opts.executeTool?.(toolCall.name, toolCall.arguments);
      await emit({
        type: "tool_execution_end",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result,
        isError: false,
      });
      const toolResultMessage = {
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: result,
        isError: false,
      };
      messages.push(toolResultMessage);
      newMessages.push(toolResultMessage);
      await emit({ type: "message_start", message: toolResultMessage });
      await emit({ type: "message_end", message: toolResultMessage });
    }
  }

  await emit({ type: "agent_end", messages: newMessages });
  return { messages: newMessages, iterations, events };
}
