import { dispatch } from "./cli.ts";
import { startTui, stopTui, type TuiState } from "./tui/tui.ts";
import { ignisState } from "./db/database.ts";
import { loadConfig, setConfigValue } from "./core/config.ts";
import { OllamaProvider, extractText } from "./core/ollama.ts";
import { buildToolset } from "./core/tools.ts";
import { loadPrompt } from "./core/prompt.ts";
import { runAgentLoop } from "./core/agent-loop.ts";
import { runWithPlanContinuation } from "./core/agent-plan.ts";

const [, , cmd, ...rest] = process.argv;

const shutdown = () => {
  stopTui();
  process.exit(0);
};

if (cmd) {
  process.exit(await dispatch(cmd, rest));
}

const cfg = loadConfig();
const provider = cfg.provider === "ollama" && cfg.model
  ? new OllamaProvider(cfg.host, cfg.model, Number(cfg.temperature) || 0.7, Number(cfg.num_ctx) || 32768)
  : null;
const toolset = buildToolset();

const state: TuiState = {
  messages: [],
  model: cfg.model || "sin modelo",
  provider: cfg.provider || "sin proveedor",
  effort: cfg.effort,
  tokensUsed: 0,
  onQuit: shutdown,
  persist: (key, value) => setConfigValue(key, value),
  onSubmit: async (text, push) => {
    if (!provider) {
      push({ role: "system", content: "sin proveedor activo: ignis config set provider ollama && ignis config set model <modelo>" });
      return;
    }
    const status = push({ role: "system", content: "· trabajando…" });
    const statusIdx = () => state.messages.indexOf(status);
    const stream = push({ role: "assistant", content: "" });
    const ac = new AbortController();
    state.cancel = () => ac.abort();
    try {
      await runWithPlanContinuation(
        {
          provider,
          model: cfg.model,
          tools: toolset.tools,
          maxIterations: 12,
          executeTool: toolset.execute,
          signal: ac.signal,
          onToken: (t) => { stream.content += t; state.refresh?.(); },
          onEvent: (ev) => {
            if (ev.type === "tool_execution_start") {
              stream.content = "";
              status.content = `· ${ev.toolName} ${Object.keys(ev.args as Record<string, unknown>)[0] ? JSON.stringify((ev.args as Record<string, unknown>)[Object.keys(ev.args as Record<string, unknown>)[0]]).slice(0, 48) : ""}…`;
              return;
            }
            if (ev.type === "message_end") {
              const m = ev.message as { role?: string; content?: unknown };
              if (m.role === "assistant") {
                const t = extractText(m.content).trim();
                stream.content = t;
                if (!t) {
                  const i = state.messages.indexOf(stream);
                  if (i >= 0) state.messages.splice(i, 1);
                }
                const j = statusIdx();
                if (j >= 0) state.messages.splice(j, 1);
                state.refresh?.();
              }
            }
          },
        },
        [
          { role: "system", content: await loadPrompt() },
          { role: "user", content: text },
        ],
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      status.content = ac.signal.aborted ? "● cancelado (esc×2)" : `● error: ${msg.slice(0, 160)}`;
      const i = state.messages.indexOf(stream);
      if (i >= 0 && !stream.content) state.messages.splice(i, 1);
      state.refresh?.();
    } finally {
      state.cancel = undefined;
    }
    state.tokensUsed = provider.promptTokens + provider.evalTokens;
  },
};

startTui(state);

process.stdin.once("end", shutdown);
process.stdin.once("close", shutdown);
void ignisState;
