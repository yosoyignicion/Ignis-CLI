const ESC = "\x1b[";

export const PALETTE = {
  bg: "#000000",
  accent: "#00f5d4",
  agentState: "#7928ca",
  border: "#3a4150",
  white: "#ffffff",
  scarlet: "#dc143c",
} as const;

export type TuiLayout = {
  mainPane: unknown;
  sidePanel?: unknown;
};

export type TuiTelemetry = {
  tokensUsed: number;
  model: string;
  latencyMs: number;
  treeNodes: number;
  costEstimate: number;
};

export type TuiMessage = {
  role: string;
  content: string;
};

export function createTuiLayout(mainPane: unknown, telemetry: TuiTelemetry): TuiLayout {
  return { mainPane, sidePanel: telemetry };
}

export function renderMainPane(messages: TuiMessage[]): string {
  const lines = messages.map((m) => `${m.role}: ${m.content}`);
  return lines.join("\n");
}

export function renderSidePanel(telemetry: TuiTelemetry): string {
  return `tokens=${telemetry.tokensUsed} model=${telemetry.model} latencyMs=${telemetry.latencyMs} treeNodes=${telemetry.treeNodes} cost=${telemetry.costEstimate}`;
}

export function renderFrame(layout: TuiLayout, telemetry: TuiTelemetry, messages: TuiMessage[]): string {
  const main = renderMainPane(messages);
  const side = renderSidePanel(telemetry);
  const border = "─".repeat(58);
  const header = `${ESC}[1;37mIgnis-CLI${ESC}[0m ${ESC}[38;2;220;20;60magent${ESC}[0m`;
  const bg = `${ESC}[48;2;0;0;0m`;
  const reset = `${ESC}[0m`;
  const top = `${bg}${ESC}[1;37m┌${border}┐${reset}`;
  const bottom = `${bg}${ESC}[1;37m└${border}┘${reset}`;
  const mid = (label: string, content: string): string => `${bg}│ ${ESC}[1;37m${label}${ESC}[0m ${content} │`;
  const lines = [
    top,
    mid("HEADER", header),
    `${bg}├${border}┤${reset}`,
    mid("MAIN", main),
    `${bg}├${border}┤${reset}`,
    mid("TELEMETRY", side),
    bottom,
  ];
  return lines.join("\n");
}
