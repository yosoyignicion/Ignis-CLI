import { readFile } from "node:fs/promises";
import { runAgentLoop, type AgentLoopOptions, type AgentLoopResult } from "./agent-loop.ts";
import { planPath } from "./tools.ts";

// Plan-then-execute: el controlador (no el modelo) garantiza la ejecución del plan.
// Si al terminar el loop el plan tiene fases pendientes, se reinicia con un empujón.
export async function runWithPlanContinuation(
  opts: AgentLoopOptions,
  messages: unknown[],
  restarts = 3,
): Promise<{ runs: AgentLoopResult[]; pending: boolean }> {
  const runs: AgentLoopResult[] = [];
  let pending = false;
  for (let r = 0; r <= restarts; r++) {
    const result = await runAgentLoop(opts, messages);
    runs.push(result);
    messages = [...messages, ...result.messages];
    pending = await hasPendingPhases();
    if (!pending) return { runs, pending: false };
    // si el modelo no ejecutó ninguna tool, un reinicio no ayuda (solo charla)
    const didWork = result.events.some((e) => e.type === "tool_execution_start");
    if (r < restarts && didWork) {
      messages.push({ role: "user", content: "[sistema] El plan tiene fases pendientes. Ejecuta la siguiente fase AHORA con una tool-call, sin preguntar." });
    } else if (!didWork) break;
  }
  return { runs, pending };
}

async function hasPendingPhases(): Promise<boolean> {
  try {
    const plan = await readFile(planPath(), "utf8");
    return /\[\s\]/.test(plan); // fase sin marcar "[ ]"
  } catch {
    return false;
  }
}
