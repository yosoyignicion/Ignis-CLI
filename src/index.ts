import { dispatch } from "./cli.ts";
import { startTui, stopTui, type TuiState } from "./tui/tui.ts";
import { ignisState } from "./db/database.ts";
import { loadConfig, setConfigValue } from "./core/config.ts";
import { OllamaProvider, extractText } from "./core/ollama.ts";
import { buildToolset } from "./core/tools.ts";
import { loadPrompt } from "./core/prompt.ts";
import { runAgentLoop } from "./core/agent-loop.ts";

const [, , cmd, ...rest] = process.argv;

const shutdown = () => {
  stopTui();
  process.exit(0);
};

if (cmd) {
  process.exit(await dispatch(cmd, rest));
}

const cfg = loadConfig();
const provider = cfg.provider === "ollama" && cfg.model ? new OllamaProvider(cfg.host, cfg.model) : null;
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
    await runAgentLoop(
      {
        provider,
        model: cfg.model,
        tools: toolset.tools,
        maxIterations: 12,
        executeTool: toolset.execute,
        onEvent: (ev) => {
          if (ev.type === "tool_execution_start") {
            status.content = `· ${ev.toolName} ${Object.keys(ev.args as Record<string, unknown>)[0] ? JSON.stringify((ev.args as Record<string, unknown>)[Object.keys(ev.args as Record<string, unknown>)[0]]).slice(0, 48) : ""}…`;
            return;
          }
          if (ev.type === "message_end") {
            const m = ev.message as { role?: string; content?: unknown };
            if (m.role === "assistant") {
              const t = extractText(m.content).trim();
              if (t) push({ role: "assistant", content: t });
              const i = statusIdx();
              if (i >= 0) state.messages.splice(i, 1);
            }
          }
        },
      },
      [
        { role: "system", content: await loadPrompt() },
        { role: "user", content: text },
      ],
    );
  },
};

startTui(state);

process.stdin.once("end", shutdown);
process.stdin.once("close", shutdown);
void ignisState;
