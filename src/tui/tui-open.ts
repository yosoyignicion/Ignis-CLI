import { createTuiLayout, startTui, stopTui } from "./tui.ts";

const telemetry = { tokensUsed: 12, model: "m", latencyMs: 3, treeNodes: 1, costEstimate: 0 };
const layout = createTuiLayout("MAIN", telemetry);
startTui({ layout, telemetry, messages: [{ role: "user", content: "task" }] });
stopTui();
console.log("TUI_OPEN_DONE");
