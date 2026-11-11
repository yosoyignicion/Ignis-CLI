import { startTui, stopTui, renderStatic, type TuiState } from "./tui.ts";

const state: TuiState = {
  messages: [{ role: "user", content: "tarea de humo" }],
  model: "recursive/flint",
  provider: "Pi",
  effort: "high",
  tokensUsed: 12,
};

startTui(state);
stopTui();
const frame = renderStatic(state);
if (frame.length === 0) {
  console.error("frame vacío");
  process.exit(1);
}
console.log("TUI_OPEN_DONE");
