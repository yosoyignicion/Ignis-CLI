import { dispatch } from "./cli.ts";
import { startTui, stopTui, type TuiState } from "./tui/tui.ts";
import { ignisState } from "./db/database.ts";
import { loadConfig, setConfigValue } from "./core/config.ts";

const [, , cmd, ...rest] = process.argv;

const shutdown = () => {
  stopTui();
  process.exit(0);
};

if (cmd) {
  process.exit(dispatch(cmd, rest));
}

const cfg = loadConfig();

const state: TuiState = {
  messages: [],
  model: cfg.model || "sin modelo",
  provider: cfg.provider || "sin proveedor",
  effort: cfg.effort,
  tokensUsed: 0,
  onQuit: shutdown,
  persist: (key, value) => setConfigValue(key, value),
};

startTui(state);

process.stdin.once("end", shutdown);
process.stdin.once("close", shutdown);
void ignisState;
