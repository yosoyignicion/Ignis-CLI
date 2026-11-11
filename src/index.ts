import { createTuiLayout, startTui, stopTui } from "./tui/tui.ts";
import { ignisState } from "./db/database.ts";
import type { TuiState } from "./tui/tui.ts";

const db = ignisState;
const telemetry = { tokensUsed: 0, model: "recursive/flint", latencyMs: 0, treeNodes: 0, costEstimate: 0 };
const layout = createTuiLayout("MAIN", telemetry);

const shutdown = () => {
  stopTui();
  process.exit(0);
};

const state: TuiState = {
  layout,
  telemetry,
  messages: [{ role: "user", content: "task" }],
  onQuit: shutdown,
};

startTui(state);

process.stdin.once("end", shutdown);
process.stdin.once("close", shutdown);
