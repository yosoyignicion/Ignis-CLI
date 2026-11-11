import { emitKeypressEvents } from "node:readline";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { VERSION } from "../version.ts";
import { planPath } from "../core/tools.ts";
import { listSkills } from "../core/skills.ts";

const ESC = "\x1b[";

export const PALETTE = {
  bg: "#000000",
  accent: "#00f5d4",
  agentState: "#7928ca",
  border: "#3a4150",
  white: "#ffffff",
  scarlet: "#dc143c",
  amber: "#ff8c00",
  gold: "#ffcc33",
  yellow: "#f5d90a",
  dim: "#6b7280",
  text: "#e5e7eb",
  boxBg: "#16161a",
  selBg: "#26262b",
} as const;

function rgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}
function fg(hex: string, bold = false, italic = false): string {
  const [r, g, b] = rgb(hex);
  return `${ESC}${bold ? "1;" : ""}${italic ? "3;" : ""}38;2;${r};${g};${b}m`;
}
function bg(hex: string): string {
  const [r, g, b] = rgb(hex);
  return `${ESC}48;2;${r};${g};${b}m`;
}
const RESET = `${ESC}0m`;

// ---------- metadatos (MCPs del proyecto) ----------
const MCP_COUNT = (() => {
  try {
    const mcp = JSON.parse(readFileSync(new URL("../../.pi/mcp.json", import.meta.url), "utf8"));
    const servers = mcp?.mcpServers ?? {};
    return Object.values(servers).filter((s: unknown) => (s as { enabled?: boolean })?.enabled !== false).length;
  } catch {
    return 0;
  }
})();

// ---------- tipos públicos ----------
export type TuiMessage = { role: "user" | "assistant" | "system"; content: string };

export type TuiState = {
  messages: TuiMessage[];
  model: string;
  provider: string;
  effort: string;
  tokensUsed?: number;
  onQuit?: () => void;
  persist?: (key: "model" | "effort" | "provider", value: string) => void;
  onSubmit?: (text: string, push: (m: TuiMessage) => TuiMessage) => Promise<void>;
  /** lo fija startTui: redibuja el frame (streaming token a token) */
  refresh?: () => void;
};

// ---------- estado interno ----------
type Command = { name: string; arg?: string; desc: string; run: (arg: string) => void };

type Runtime = {
  state: TuiState;
  input: string;
  caret: number;
  menuIndex: number;
  paletteOpen: boolean;
  paletteQuery: string;
  paletteIndex: number;
  agentsMode: boolean;
  running: boolean;
};

let rt: Runtime | null = null;

// ---------- logo pixel-art "Ignis" ----------
const GLYPHS: Array<{ w: number; rows: string[] }> = [
  { w: 3, rows: ["███", " █ ", " █ ", " █ ", "███"] }, // I
  { w: 5, rows: ["█████", "█   █", "█████", "    █", "█████"] }, // g
  { w: 4, rows: ["████", "█  █", "█  █", "█  █", "█  █"] }, // n
  { w: 2, rows: ["██", "  ", "██", "██", "██"] }, // i
  { w: 4, rows: ["████", "█   ", "████", "   █", "████"] }, // s
];

function lerpColor(a: string, b: string, t: number): string {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const bl = Math.round(b1 + (b2 - b1) * t);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${bl.toString(16).padStart(2, "0")}`;
}

function renderLogo(): string[] {
  const colors = GLYPHS.map((_, k) => lerpColor(PALETTE.scarlet, PALETTE.amber, GLYPHS.length > 1 ? k / (GLYPHS.length - 1) : 0));
  const rows: string[] = [];
  for (let y = 0; y < 5; y++) {
    let line = "";
    GLYPHS.forEach((glyph, k) => {
      const color = y === 0 ? PALETTE.gold : colors[k];
      line += `${fg(color, true)}${glyph.rows[y]}${RESET}`;
      line += " ";
    });
    rows.push(line);
  }
  return rows;
}

// ---------- comandos ----------
function setSystemMsg(rt: Runtime, content: string): void {
  rt.state.messages.push({ role: "system", content });
  if (rt.running) draw();
}

function commands(rt: Runtime): Command[] {
  return [
    { name: "/help", desc: "lista de comandos", run: () => { for (const c of commands(rt)) setSystemMsg(rt, `${c.name}${c.arg ? " " + c.arg : ""} — ${c.desc}`); } },
    { name: "/model", arg: "<model>", desc: "cambia el modelo activo", run: (a) => { if (a) { rt.state.model = a; rt.state.persist?.("model", a); setSystemMsg(rt, `modelo activo → ${a}`); } else setSystemMsg(rt, "uso: /model <provider/model>"); } },
    { name: "/effort", arg: "<none|low|medium|high|max>", desc: "nivel de effort/reasoning", run: (a) => { if (["none", "low", "medium", "high", "max"].includes(a)) { rt.state.effort = a; rt.state.persist?.("effort", a); setSystemMsg(rt, `effort → ${a}`); } else setSystemMsg(rt, "uso: /effort <none|low|medium|high|max>"); } },
    { name: "/provider", arg: "<nombre>", desc: "proveedor activo (p.ej. ollama)", run: (a) => { if (a) { rt.state.provider = a; rt.state.persist?.("provider", a); setSystemMsg(rt, `proveedor → ${a}`); } else setSystemMsg(rt, "uso: /provider <nombre>"); } },
    { name: "/agents", desc: "alternar modo agentes", run: () => { rt.agentsMode = !rt.agentsMode; setSystemMsg(rt, `modo agentes → ${rt.agentsMode ? "on" : "off"}`); } },
    { name: "/plan", desc: "ver el plan de la tarea actual", run: async () => { try { const plan = await readFile(planPath(), "utf8"); for (const line of plan.trim().split("\n")) setSystemMsg(rt, `plan: ${line}`); } catch { setSystemMsg(rt, "sin plan (plan_write lo crea el agente)"); } } },
    { name: "/mcps", desc: "MCPs del proyecto con estado", run: () => { try { const obj = JSON.parse(readFileSync(join(process.cwd(), ".pi", "mcp.json"), "utf8")) as { mcpServers?: Record<string, { enabled?: boolean }> }; const servers = obj.mcpServers ?? {}; const names = Object.keys(servers); if (names.length === 0) setSystemMsg(rt, "sin MCPs en .pi/mcp.json"); for (const n of names) setSystemMsg(rt, `mcp: ${n} [${servers[n]?.enabled !== false ? "habilitado" : "deshabilitado"}] (gestiona: ignis mcps en consola)`); } catch { setSystemMsg(rt, "no hay .pi/mcp.json en este proyecto"); } } },
    { name: "/skills", desc: "skills reconocidas y usables", run: async () => { const skills = await listSkills(); if (skills.length === 0) { setSystemMsg(rt, "sin skills — crea .md en ~/.config/ignis/skills o .pi/skills"); return; } for (const s of skills) setSystemMsg(rt, `skill: ${s.name} [${s.source}]`); } },
    { name: "/update", desc: "comprobar última release de GitHub", run: async () => { try { const res = await fetch("https://api.github.com/repos/yosoyignicion/Ignis-CLI/releases/latest", { headers: { "user-agent": "ignis-cli" }, signal: AbortSignal.timeout(5000) }); const tag = (await res.json() as { tag_name?: string }).tag_name ?? ""; if (tag.slice(1) === VERSION) setSystemMsg(rt, `estás en la última versión (${VERSION})`); else setSystemMsg(rt, `disponible ${tag} — ejecuta: ignis update en consola`); } catch { setSystemMsg(rt, "no se pudo consultar GitHub"); } } },
    { name: "/clear", desc: "limpia la conversación", run: () => { rt.state.messages.length = 0; rt.input = ""; rt.caret = 0; } },
    { name: "/quit", desc: "salir de Ignis", run: () => quit(rt) },
  ];
}

function filterCommands(rt: Runtime, prefix: string): Command[] {
  return commands(rt).filter((c) => c.name.startsWith(prefix));
}

function execInput(rt: Runtime): void {
  const text = rt.input.trim();
  if (!text) return;
  if (text.startsWith("/")) {
    const [word, ...rest] = text.split(/\s+/);
    const arg = rest.join(" ");
    const cmd = commands(rt).find((c) => c.name === word);
    if (cmd) {
      rt.state.messages.push({ role: "user", content: text });
      cmd.run(arg);
    } else {
      setSystemMsg(rt, `comando desconocido: ${word} (ctrl+p para ver la lista)`);
    }
  } else {
    rt.state.messages.push({ role: "user", content: text });
    const push = (m: TuiMessage): TuiMessage => { rt.state.messages.push(m); if (rt.running) draw(); return m; };
    const submit = rt.state.onSubmit;
    if (submit) {
      void submit(text, push).catch((e) => push({ role: "system", content: `error: ${e instanceof Error ? e.message : String(e)}` })).finally(() => { if (rt.running) draw(); });
    } else {
      setSystemMsg(rt, "demo: agent-loop sin cablear — provider registry vacío");
    }
  }
  rt.input = "";
  rt.caret = 0;
  rt.menuIndex = 0;
}

function quit(rt: Runtime): void {
  rt.running = false;
  stopTui();
  rt.state.onQuit?.();
}

// ---------- composición del frame ----------
function wrap(text: string, width: number): string[] {
  if (width <= 0) return [text];
  const out: string[] = [];
  for (const word of text.split("\n")) {
    let line = "";
    for (const token of word.split(" ")) {
      if (line && (line + " " + token).length > width) { out.push(line); line = token; }
      else line = line ? line + " " + token : token;
    }
    out.push(line);
  }
  return out;
}

function renderTranscriptLine(m: TuiMessage, width: number): string[] {
  const wrapped = wrap(m.content, Math.max(10, width - 3));
  if (m.role === "user") {
    return wrapped.map((w, i) => (i === 0 ? `${fg(PALETTE.accent, true)}❯${RESET} ${fg(PALETTE.text)}${w}${RESET}` : `  ${fg(PALETTE.text)}${w}${RESET}`));
  }
  if (m.role === "system") {
    return wrapped.map((w, i) => (i === 0 ? `  ${fg(PALETTE.dim, true, true)}· ${w}${RESET}` : `    ${fg(PALETTE.dim, true, true)}${w}${RESET}`));
  }
  return wrapped.map((w, i) => (i === 0 ? `${fg(PALETTE.dim)}●${RESET} ${fg(PALETTE.dim)}${w}${RESET}` : `  ${fg(PALETTE.dim)}${w}${RESET}`));
}

function renderBox(rt: Runtime, cols: number): { lines: string[]; boxX: number; caretRow: number; caretCol: number } {
  const boxW = Math.max(24, Math.min(cols - 6, 64));
  const inner = boxW - 3;
  const bar = `${fg(PALETTE.agentState)}▌${RESET}`;
  const visibleLen = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "").length;
  const field = (content: string) => `${bg(PALETTE.boxBg)} ${content}${" ".repeat(Math.max(0, boxW - 2 - visibleLen(content)))}${RESET}`;
  const lines: string[] = [];
  const textW = Math.max(1, inner - 1);
  const start = rt.caret > textW ? rt.caret - textW : 0;
  const visible = rt.input.slice(start, start + textW);
  const caretCol = 2 + (rt.caret - start);
  if (rt.input.length === 0) {
    lines.push(`${bar}${field(`${fg(PALETTE.dim)}Ask anything… "Fix a TODO in the codebase"${RESET}`)}`);
  } else {
    lines.push(`${bar}${field(`${fg(PALETTE.text)}${visible}${RESET}`)}`);
  }
  const status =
    `${fg(PALETTE.white, true)}[${rt.state.provider}]${RESET}` +
    `${fg(PALETTE.dim)} · ${rt.state.model} · effort ${RESET}${fg(PALETTE.yellow)}[${rt.state.effort}]${RESET}` +
    (rt.agentsMode ? `${fg(PALETTE.dim)} · ${RESET}${fg(PALETTE.accent, true)}agents${RESET}` : "");
  lines.push(`${bar}${field(status)}`);
  return { lines, boxX: 0, caretRow: 0, caretCol: Math.min(caretCol, boxW - 1) };
}

function renderHints(rt: Runtime, cols: number): string {
  void rt;
  const right = `${fg(PALETTE.white, true)}shift+tab${RESET}${fg(PALETTE.dim)} agents  ${RESET}${fg(PALETTE.white, true)}ctrl+p${RESET}${fg(PALETTE.dim)} commands${RESET}`;
  const pad = Math.max(1, cols - 2 - 46);
  return `${fg(PALETTE.dim)}~${RESET}${" ".repeat(pad - 1)}${right}`;
}

function renderFooter(rt: Runtime, cols: number): string {
  const left = `${fg(PALETTE.dim)}${rt.state.tokensUsed ?? 0} ${RESET}${fg(PALETTE.dim)}${MCP_COUNT} MCP /mcp${RESET}`;
  const right = `${fg(PALETTE.dim, true)}Version ${VERSION}${RESET}`;
  const pad = Math.max(1, cols - 14 - right.length + 8);
  return `${left}${" ".repeat(Math.max(1, cols - left.length - right.length))}${right}`;
}

function renderMenu(rt: Runtime, rows: string[], boxRow: number): void {
  const prefix = rt.input.startsWith("/") ? rt.input.split(/\s+/)[0] : "";
  const filtered = filterCommands(rt, prefix);
  if (!prefix || filtered.length === 0) return;
  const height = Math.min(5, filtered.length, Math.max(0, boxRow - 1));
  if (height === 0) return;
  rt.menuIndex = Math.min(rt.menuIndex, filtered.length - 1);
  const width = Math.max(24, Math.min(rows[0].length + 40, 64));
  const top = Math.max(0, boxRow - height - 1);
  const start = Math.max(0, Math.min(rt.menuIndex - height + 1, filtered.length - height));
  for (let i = 0; i < height; i++) {
    const idx = start + i;
    if (idx >= filtered.length) break;
    const cmd = filtered[idx];
    const selected = idx === rt.menuIndex;
    const line = `${selected ? bg(PALETTE.selBg) : ""}` +
      ` ${fg(selected ? PALETTE.white : PALETTE.text, true)}${cmd.name.padEnd(12)}${RESET}` +
      `${selected ? bg(PALETTE.selBg) : ""}${fg(PALETTE.dim)}${cmd.desc}${RESET}` +
      `${selected ? bg(PALETTE.selBg) : ""}${" ".repeat(Math.max(0, width - 14 - cmd.desc.length))}${RESET}`;
    rows[top + i] = line.slice(0, line.length);
  }
  void width;
}

function renderPalette(rt: Runtime, rows: string[], cols: number, totalRows: number): { caretRow: number; caretCol: number } | null {
  if (!rt.paletteOpen) return null;
  const filtered = filterCommands(rt, rt.paletteQuery.replace(/^\//, ""));
  rt.paletteIndex = Math.min(rt.paletteIndex, Math.max(0, filtered.length - 1));
  const w = Math.min(cols - 4, 46);
  const h = Math.min(4 + filtered.length, 10, totalRows - 2);
  const top = Math.floor((totalRows - h) / 2);
  const left = Math.floor((cols - w) / 2);
  const put = (r: number, content: string) => {
    if (r >= 0 && r < totalRows) rows[r] = content;
  };
  put(top, `${fg(PALETTE.border)}┌${"─".repeat(w - 2)}┐${RESET}`);
  put(top + 1, `${fg(PALETTE.border)}│${RESET}${fg(PALETTE.white, true)} commands${RESET}${" ".repeat(Math.max(0, w - 11))}${fg(PALETTE.border)}│${RESET}`);
  const q = ` ❯ ${rt.paletteQuery}`;
  put(top + 2, `${fg(PALETTE.border)}│${RESET}${fg(PALETTE.text)}${q.slice(0, w - 3)}${RESET}${" ".repeat(Math.max(0, w - 3 - q.length))}${fg(PALETTE.border)}│${RESET}`);
  put(top + 3, `${fg(PALETTE.border)}├${"─".repeat(w - 2)}┤${RESET}`);
  const showCount = Math.max(1, h - 5);
  const start = Math.max(0, Math.min(rt.paletteIndex - showCount + 1, filtered.length - showCount));
  const show = filtered.slice(start, start + showCount);
  for (let i = 0; i < show.length; i++) {
    const cmd = show[i];
    const selected = start + i === rt.paletteIndex;
    const descCut = cmd.desc.slice(0, Math.max(0, w - 17));
    const line = ` ${fg(selected ? PALETTE.white : PALETTE.text, true)}${cmd.name.padEnd(12)}${RESET}${fg(PALETTE.dim)}${descCut}${RESET}`;
    put(top + 4 + i, `${fg(PALETTE.border)}│${RESET}${selected ? bg(PALETTE.selBg) : ""}${line}${" ".repeat(Math.max(0, w - 2 - 13 - descCut.length))}${RESET}${selected ? bg(PALETTE.selBg) : ""}${fg(PALETTE.border)}│${RESET}`);
  }
  put(top + h - 1, `${fg(PALETTE.border)}└${"─".repeat(w - 2)}┘${RESET}`);
  return { caretRow: top + 2, caretCol: Math.min(w - 2, left + 4 + rt.paletteQuery.length) };
}

type Frame = { text: string; caretRow: number; caretCol: number };

function compose(rt: Runtime, cols: number, rows: number): Frame {
  const totalRows = Math.max(6, rows);
  const c = Math.max(40, cols);
  const lines: string[] = new Array(totalRows).fill("");

  const box = renderBox(rt, c);
  const hints = renderHints(rt, c);
  const footer = renderFooter(rt, c);

  let boxRow: number;
  if (rt.state.messages.length === 0) {
    const logo = renderLogo();
    const logoRow = Math.max(1, Math.floor(totalRows * 0.2));
    const logoX = Math.floor((c - 22) / 2);
    for (let i = 0; i < logo.length; i++) {
      lines[logoRow + i] = " ".repeat(Math.max(0, logoX)) + logo[i];
    }
    boxRow = Math.min(logoRow + 6, totalRows - 4);
  } else {
    const maxTranscript = Math.max(1, totalRows - 5);
    const rendered: string[] = [];
    for (const m of rt.state.messages) rendered.push(...renderTranscriptLine(m, c));
    const tail = rendered.slice(-maxTranscript);
    for (let i = 0; i < tail.length; i++) lines[i] = tail[i];
    boxRow = totalRows - 4;
  }

  lines[boxRow] = box.lines[0];
  lines[boxRow + 1] = box.lines[1];
  lines[boxRow + 2] = hints;
  lines[totalRows - 1] = footer;

  renderMenu(rt, lines, boxRow);
  let caretRow = boxRow;
  let caretCol = box.caretCol + 1;
  const pal = renderPalette(rt, lines, c, totalRows);
  if (pal) {
    caretRow = pal.caretRow;
    caretCol = pal.caretCol;
  }

  let text = `${ESC}H`;
  for (let i = 0; i < totalRows; i++) {
    if (i > 0) text += "\r\n";
    text += (lines[i] ?? "") + `${ESC}K`; // pinta la fila y limpia el resto de la línea
  }
  text += `${ESC}${caretRow + 1};${caretCol + 1}H`;
  return { text, caretRow, caretCol };
}

export function renderStatic(state: TuiState, cols = 80, rows = 24): string {
  const fake: Runtime = {
    state,
    input: "",
    caret: 0,
    menuIndex: 0,
    paletteOpen: false,
    paletteQuery: "",
    paletteIndex: 0,
    agentsMode: false,
    running: false,
  };
  return compose(fake, cols, rows).text;
}

function draw(): void {
  if (!rt || !process.stdout.isTTY) return;
  const cols = process.stdout.columns ?? 80;
  const rows = process.stdout.rows ?? 24;
  process.stdout.write(compose(rt, cols, rows).text);
}

// ---------- interacción ----------
function onKeypress(str: string | undefined, key: { name?: string; ctrl?: boolean; shift?: boolean; sequence?: string } | undefined): void {
  if (!rt || !rt.running) return;
  const k = key ?? {};
  if (k.ctrl && (k.name === "c" || k.name === "d")) { quit(rt); return; }

  if (rt.paletteOpen) {
    if (k.name === "escape") { rt.paletteOpen = false; }
    else if (k.name === "up") { rt.paletteIndex = Math.max(0, rt.paletteIndex - 1); }
    else if (k.name === "down") { rt.paletteIndex += 1; }
    else if (k.name === "return" || k.name === "enter") {
      const filtered = filterCommands(rt, rt.paletteQuery.replace(/^\//, ""));
      const cmd = filtered[Math.min(rt.paletteIndex, filtered.length - 1)];
      rt.paletteOpen = false;
      if (cmd) { cmd.run(""); draw(); return; }
    } else if (k.name === "backspace") { rt.paletteQuery = rt.paletteQuery.slice(0, -1); rt.paletteIndex = 0; }
    else if (str && str >= " " && !k.ctrl && !k.meta) { rt.paletteQuery += str; rt.paletteIndex = 0; }
    draw();
    return;
  }

  switch (k.name) {
    case "escape":
      break;
    case "up":
      if (rt.input.startsWith("/")) rt.menuIndex = Math.max(0, rt.menuIndex - 1);
      break;
    case "down":
      if (rt.input.startsWith("/")) rt.menuIndex += 1;
      break;
    case "tab":
      if (k.shift) { rt.agentsMode = !rt.agentsMode; }
      else if (rt.input.startsWith("/")) {
        const filtered = filterCommands(rt, rt.input.split(/\s+/)[0]);
        if (filtered.length > 0) {
          rt.input = filtered[Math.min(rt.menuIndex, filtered.length - 1)].name + " ";
          rt.caret = rt.input.length;
        }
      }
      break;
    case "left":
      rt.caret = Math.max(0, rt.caret - 1);
      break;
    case "right":
      rt.caret = Math.min(rt.input.length, rt.caret + 1);
      break;
    case "home":
      rt.caret = 0;
      break;
    case "end":
      rt.caret = rt.input.length;
      break;
    case "backspace":
      if (rt.caret > 0) { rt.input = rt.input.slice(0, rt.caret - 1) + rt.input.slice(rt.caret); rt.caret -= 1; }
      break;
    case "delete":
      rt.input = rt.input.slice(0, rt.caret) + rt.input.slice(rt.caret + 1);
      break;
    case "return":
    case "enter": {
      if (rt.input.startsWith("/")) {
        const word = rt.input.split(/\s+/)[0];
        const exact = commands(rt).find((cmd) => cmd.name === word);
        if (!exact) {
          const filtered = filterCommands(rt, word);
          if (filtered.length > 0) {
            rt.input = filtered[Math.min(rt.menuIndex, filtered.length - 1)].name + " ";
            rt.caret = rt.input.length;
            rt.menuIndex = 0;
            draw();
            return;
          }
        }
      }
      execInput(rt);
      break;
    }
    case "p":
      if (k.ctrl) { rt.paletteOpen = true; rt.paletteQuery = ""; rt.paletteIndex = 0; }
      else if (str === "p") insertStr(rt, "p");
      break;
    case "u":
      if (k.ctrl) { rt.input = ""; rt.caret = 0; }
      else if (str === "u") insertStr(rt, "u");
      break;
    default:
      if (str && str >= " " && !k.ctrl && !k.meta) insertStr(rt, str);
      break;
  }
  draw();
}

function insertStr(rt: Runtime, s: string): void {
  rt.input = rt.input.slice(0, rt.caret) + s + rt.input.slice(rt.caret);
  rt.caret += s.length;
  if (rt.input.startsWith("/") && rt.caret <= rt.input.split(/\s+/)[0].length + 1) rt.menuIndex = 0;
}

// ---------- ciclo de vida ----------
export function startTui(state: TuiState): void {
  rt = {
    state,
    input: "",
    caret: 0,
    menuIndex: 0,
    paletteOpen: false,
    paletteQuery: "",
    paletteIndex: 0,
    agentsMode: false,
    running: true,
  };
  state.refresh = () => { if (rt?.running) draw(); };
  if (!process.stdout.isTTY) {
    process.stdout.write(renderStatic(state) + "\n");
    return;
  }
  process.stdout.write(`${ESC}?1049h${ESC}?25l`);
  process.stdin.setRawMode(true);
  emitKeypressEvents(process.stdin);
  process.stdin.on("keypress", onKeypress);
  process.on("SIGWINCH", () => draw());
  draw();
}

export function stopTui(): void {
  if (process.stdout.isTTY) {
    process.stdout.write(`${ESC}?25h${ESC}?1049l`);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
      process.stdin.removeAllListeners("keypress");
    }
  }
  rt = null;
}
