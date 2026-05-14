import { emitKeypressEvents } from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import {
  buildPromptForStoredTicket,
  classifyStoredTicket,
  getBranchPolicySettings,
  getExecution,
  listExecutions,
  listTickets,
  loadOpenTopConfig,
  loadOpenTopProjectContext,
  setConfigValue,
  startExecutionForStoredTicket,
  type Execution,
  type ExecutionBranchPolicy,
  type OpenTopConfig,
  type OpenTopProjectContext,
  type Ticket
} from "@opentop/core";
import { createSqliteExecutionRepository, createSqliteTicketRepository } from "@opentop/db";
import { getRepositoryStatus, GitExecutionWorkspace, type RepositoryStatus } from "@opentop/git";

type PanelId = "overview" | "tickets" | "executions" | "settings" | "help";
type MessageTone = "info" | "success" | "warning" | "error";

interface DashboardMessage {
  tone: MessageTone;
  text: string;
}

interface TicketInspection {
  mode: "classification" | "prompt";
  classification?: Awaited<ReturnType<typeof classifyStoredTicket>>;
  prompt?: Awaited<ReturnType<typeof buildPromptForStoredTicket>>;
}

interface DashboardState {
  targetDirectory: string;
  config: OpenTopConfig;
  projectContext: OpenTopProjectContext;
  repositoryStatus: RepositoryStatus;
  tickets: Ticket[];
  executions: Execution[];
  activePanel: PanelId;
  selectedTicketIndex: number;
  selectedExecutionIndex: number;
  selectedOverviewIndex: number;
  projectBranchPolicy?: ExecutionBranchPolicy;
  userBranchPolicy?: ExecutionBranchPolicy;
  ticketInspection?: TicketInspection;
  executionDetail?: Execution;
  message?: DashboardMessage;
  busy: boolean;
}

const PANELS: readonly PanelId[] = ["overview", "tickets", "executions", "settings", "help"] as const;
const BRANCH_POLICIES: readonly ExecutionBranchPolicy[] = ["new", "reuse-current", "manual", "none"] as const;
const ANSI = {
  reset: "\u001B[0m",
  bold: "\u001B[1m",
  dim: "\u001B[2m",
  cyan: "\u001B[36m",
  blue: "\u001B[34m",
  green: "\u001B[32m",
  yellow: "\u001B[33m",
  red: "\u001B[31m",
  magenta: "\u001B[35m",
  gray: "\u001B[90m",
  inverse: "\u001B[7m"
} as const;

export async function startDashboard(targetDirectory: string): Promise<void> {
  if (!input.isTTY || !output.isTTY) {
    throw new Error("OpenTop dashboard requires an interactive TTY.");
  }

  let state = await loadDashboardState(targetDirectory);
  let closed = false;
  let busyPromise = Promise.resolve();

  emitKeypressEvents(input);
  input.setRawMode?.(true);
  input.resume();

  const cleanup = () => {
    if (closed) {
      return;
    }

    closed = true;
    input.removeListener("keypress", onKeypress);
    input.setRawMode?.(false);
    console.clear();
  };

  const onKeypress = (character: string, key: { name?: string; ctrl?: boolean; shift?: boolean }) => {
    if (closed) {
      return;
    }

    if (key.ctrl && key.name === "c") {
      cleanup();
      return;
    }

    busyPromise = busyPromise
      .then(async () => {
        const next = await handleKeypress(state, character, key);

        if (next === null) {
          cleanup();
          return;
        }

        state = next;
        renderDashboard(state);
      })
      .catch((error: unknown) => {
        state = {
          ...state,
          busy: false,
          message: { tone: "error", text: error instanceof Error ? error.message : String(error) }
        };
        renderDashboard(state);
      });
  };

  input.on("keypress", onKeypress);
  renderDashboard(state);

  await new Promise<void>((resolve) => {
    const poll = setInterval(() => {
      if (closed) {
        clearInterval(poll);
        resolve();
      }
    }, 50);
  });
}

async function loadDashboardState(targetDirectory: string): Promise<DashboardState> {
  const [config, projectContext, repositoryStatus, settings] = await Promise.all([
    loadOpenTopConfig(undefined, targetDirectory),
    loadOpenTopProjectContext(targetDirectory),
    getRepositoryStatus(targetDirectory),
    getBranchPolicySettings(targetDirectory)
  ]);

  const ticketRepository = await createSqliteTicketRepository({ startDirectory: targetDirectory });
  const executionRepository = await createSqliteExecutionRepository({ startDirectory: targetDirectory });
  const tickets = await listTickets(ticketRepository);
  const executions = await listExecutions(executionRepository);

  return {
    targetDirectory,
    config,
    projectContext,
    repositoryStatus,
    tickets,
    executions,
    activePanel: "overview",
    selectedOverviewIndex: 0,
    selectedTicketIndex: tickets.length > 0 ? 0 : -1,
    selectedExecutionIndex: executions.length > 0 ? 0 : -1,
    projectBranchPolicy: settings.project,
    userBranchPolicy: settings.user,
    busy: false
  };
}

async function refreshDashboardState(state: DashboardState): Promise<DashboardState> {
  const fresh = await loadDashboardState(state.targetDirectory);
  const nextTicketIndex =
    fresh.tickets.length === 0
      ? -1
      : clampIndex(state.selectedTicketIndex, fresh.tickets.length);
  const nextExecutionIndex =
    fresh.executions.length === 0
      ? -1
      : clampIndex(state.selectedExecutionIndex, fresh.executions.length);

  return {
    ...fresh,
    activePanel: state.activePanel,
    selectedOverviewIndex: clampIndex(state.selectedOverviewIndex, 3),
    selectedTicketIndex: nextTicketIndex,
    selectedExecutionIndex: nextExecutionIndex,
    ticketInspection:
      state.ticketInspection && nextTicketIndex >= 0 && fresh.tickets[nextTicketIndex]?.id === selectedTicketId(state)
        ? state.ticketInspection
        : undefined,
    executionDetail:
      state.executionDetail && nextExecutionIndex >= 0 && fresh.executions[nextExecutionIndex]?.id === state.executionDetail.id
        ? state.executionDetail
        : undefined,
    message: state.message,
    busy: false
  };
}

async function handleKeypress(
  state: DashboardState,
  character: string,
  key: { name?: string; ctrl?: boolean; shift?: boolean }
): Promise<DashboardState | null> {
  if (character === "q" || key.name === "escape") {
    return null;
  }

  if (key.name === "tab" || character === "l" || key.name === "right") {
    return withActivePanel(state, 1);
  }

  if ((key.name === "tab" && key.shift) || character === "h" || key.name === "left") {
    return withActivePanel(state, -1);
  }

  if (character === "r") {
    return {
      ...(await refreshDashboardState({ ...state, busy: true, message: { tone: "info", text: "Refreshed dashboard." } })),
      message: { tone: "info", text: "Refreshed dashboard." }
    };
  }

  if (character === "?") {
    return { ...state, activePanel: "help", message: undefined };
  }

  if (key.name === "up" || character === "k") {
    return moveSelection(state, -1);
  }

  if (key.name === "down" || character === "j") {
    return moveSelection(state, 1);
  }

  if (key.name === "return") {
    return runPrimaryAction(state);
  }

  if (state.activePanel === "tickets") {
    if (character === "c") {
      return inspectSelectedTicket(state, "classification");
    }

    if (character === "p") {
      return inspectSelectedTicket(state, "prompt");
    }

    if (character === "x") {
      return runSelectedTicket(state);
    }
  }

  if (state.activePanel === "settings") {
    if (character === "u") {
      return cycleBranchPolicy(state, "user");
    }
  }

  return state;
}

function withActivePanel(state: DashboardState, delta: number): DashboardState {
  const currentIndex = PANELS.indexOf(state.activePanel);
  const nextIndex = (currentIndex + delta + PANELS.length) % PANELS.length;
  return { ...state, activePanel: PANELS[nextIndex], message: undefined };
}

function moveSelection(state: DashboardState, delta: number): DashboardState {
  if (state.activePanel === "overview") {
    return {
      ...state,
      selectedOverviewIndex: clampIndex(state.selectedOverviewIndex + delta, 3),
      message: undefined
    };
  }

  if (state.activePanel === "tickets" && state.tickets.length > 0) {
    return {
      ...state,
      selectedTicketIndex: clampIndex(state.selectedTicketIndex + delta, state.tickets.length),
      ticketInspection: undefined,
      message: undefined
    };
  }

  if (state.activePanel === "executions" && state.executions.length > 0) {
    return {
      ...state,
      selectedExecutionIndex: clampIndex(state.selectedExecutionIndex + delta, state.executions.length),
      executionDetail: undefined,
      message: undefined
    };
  }

  return state;
}

async function runPrimaryAction(state: DashboardState): Promise<DashboardState> {
  if (state.activePanel === "overview") {
    return runOverviewAction(state);
  }

  if (state.activePanel === "tickets") {
    return inspectSelectedTicket(state, "classification");
  }

  if (state.activePanel === "executions") {
    return inspectSelectedExecution(state);
  }

  if (state.activePanel === "settings") {
    return cycleBranchPolicy(state, "project");
  }

  return state;
}

async function runOverviewAction(state: DashboardState): Promise<DashboardState> {
  const actions = ["status", "tickets", "executions", "settings"] as const;
  const selected = actions[clampIndex(state.selectedOverviewIndex, actions.length)];

  if (selected === "status") {
    return {
      ...(await refreshDashboardState(state)),
      message: { tone: "info", text: "Refreshed overview." }
    };
  }

  if (selected === "tickets") {
    return { ...state, activePanel: "tickets", message: undefined };
  }

  if (selected === "executions") {
    return { ...state, activePanel: "executions", message: undefined };
  }

  return { ...state, activePanel: "settings", message: undefined };
}

async function inspectSelectedTicket(
  state: DashboardState,
  mode: "classification" | "prompt"
): Promise<DashboardState> {
  const ticket = state.tickets[state.selectedTicketIndex];

  if (!ticket) {
    return {
      ...state,
      message: { tone: "warning", text: "No ticket selected." }
    };
  }

  const ticketRepository = await createSqliteTicketRepository({ startDirectory: state.targetDirectory });

  if (mode === "classification") {
    const classification = await classifyStoredTicket(ticketRepository, state.config, ticket.id);
    return {
      ...state,
      ticketInspection: { mode, classification },
      message: { tone: "info", text: `Loaded classification for ticket ${ticket.id}.` }
    };
  }

  const prompt = await buildPromptForStoredTicket(ticketRepository, state.config, state.projectContext, ticket.id);
  return {
    ...state,
    ticketInspection: { mode, prompt },
    message: { tone: "info", text: `Loaded prompt preview for ticket ${ticket.id}.` }
  };
}

async function runSelectedTicket(state: DashboardState): Promise<DashboardState> {
  const ticket = state.tickets[state.selectedTicketIndex];

  if (!ticket) {
    return {
      ...state,
      message: { tone: "warning", text: "No ticket selected." }
    };
  }

  const [ticketRepository, executionRepository, repositoryState] = await Promise.all([
    createSqliteTicketRepository({ startDirectory: state.targetDirectory }),
    createSqliteExecutionRepository({ startDirectory: state.targetDirectory }),
    getRepositoryStatus(state.targetDirectory)
  ]);

  const result = await startExecutionForStoredTicket(
    ticketRepository,
    executionRepository,
    new GitExecutionWorkspace(state.targetDirectory),
    state.config,
    state.projectContext,
    ticket.id,
    repositoryState
  );

  const refreshed = await refreshDashboardState(state);

  if (result.status === "blocked") {
    return {
      ...refreshed,
      message: {
        tone: "warning",
        text: `Execution blocked: ${result.branchResolution.reason}`
      }
    };
  }

  if (result.status === "failed") {
    return {
      ...refreshed,
      activePanel: "executions",
      selectedExecutionIndex: refreshed.executions.findIndex((execution) => execution.id === result.execution.id),
      executionDetail: result.execution,
      message: {
        tone: "error",
        text: `Execution failed during branch preparation: ${result.error}`
      }
    };
  }

  return {
    ...refreshed,
    activePanel: "executions",
    selectedExecutionIndex: refreshed.executions.findIndex((execution) => execution.id === result.execution.id),
    executionDetail: result.execution,
    message: {
      tone: "success",
      text: `Queued execution ${result.execution.id} on branch ${result.execution.branchName}.`
    }
  };
}

async function inspectSelectedExecution(state: DashboardState): Promise<DashboardState> {
  const execution = state.executions[state.selectedExecutionIndex];

  if (!execution) {
    return {
      ...state,
      message: { tone: "warning", text: "No execution selected." }
    };
  }

  const repository = await createSqliteExecutionRepository({ startDirectory: state.targetDirectory });
  const detail = await getExecution(repository, execution.id);
  return {
    ...state,
    executionDetail: detail,
    message: { tone: "info", text: `Loaded execution ${detail.id}.` }
  };
}

async function cycleBranchPolicy(
  state: DashboardState,
  scope: "project" | "user"
): Promise<DashboardState> {
  const current = scope === "project" ? state.projectBranchPolicy : state.userBranchPolicy;
  const next = BRANCH_POLICIES[(BRANCH_POLICIES.indexOf(current ?? "reuse-current") + 1) % BRANCH_POLICIES.length];

  await setConfigValue("execution.defaultBranchPolicy", next, scope, state.targetDirectory);
  const refreshed = await refreshDashboardState(state);
  return {
    ...refreshed,
    activePanel: "settings",
    message: { tone: "success", text: `Set ${scope} branch policy to ${next}.` }
  };
}

function renderDashboard(state: DashboardState): void {
  console.clear();
  const width = Math.max(output.columns ?? 100, 80);
  const bodyLines = renderBody(state, width);

  console.log(colorize("   ____                ______            ", "cyan"));
  console.log(colorize("  / __ \\____  ___     /_  __/___  ____   ", "cyan"));
  console.log(colorize(" / / / / __ \\/ _ \\     / / / __ \\/ __ \\  ", "cyan"));
  console.log(colorize("/ /_/ / /_/ /  __/    / / / /_/ / /_/ /  ", "cyan"));
  console.log(colorize("\\____/ .___/\\___/    /_/  \\____/ .___/   ", "cyan"));
  console.log(colorize("    /_/                       /_/        ", "cyan"));
  console.log(colorize("Open Ticket Orchestrator Platform", "bold"));
  console.log("");
  console.log(renderTabs(state.activePanel, width));
  console.log(colorize("─".repeat(width), "gray"));

  for (const line of bodyLines) {
    console.log(line);
  }

  const bodyHeight = bodyLines.length;
  const totalHeight = output.rows ?? 30;
  const usedHeight = 9 + bodyHeight;
  const padCount = Math.max(0, totalHeight - usedHeight - 4);
  for (let index = 0; index < padCount; index += 1) {
    console.log("");
  }

  console.log(colorize("─".repeat(width), "gray"));
  console.log(renderShortcutBar(state.activePanel, width));
  console.log(renderMessageBar(state.message, width));
}

function renderBody(state: DashboardState, width: number): string[] {
  if (state.activePanel === "overview") {
    return renderOverview(state, width);
  }

  if (state.activePanel === "tickets") {
    return renderTicketsPanel(state, width);
  }

  if (state.activePanel === "executions") {
    return renderExecutionsPanel(state, width);
  }

  if (state.activePanel === "settings") {
    return renderSettingsPanel(state, width);
  }

  return renderHelpPanel(width);
}

function renderOverview(state: DashboardState, width: number): string[] {
  const leftWidth = Math.min(34, Math.floor(width * 0.34));
  const rightWidth = width - leftWidth - 3;
  const actions = [
    `Status: ${state.repositoryStatus.isClean ? colorize("clean", "green") : colorize("dirty", "yellow")}`,
    `Tickets: ${state.tickets.length}`,
    `Executions: ${state.executions.length}`,
    `Settings: ${state.config.execution.defaultBranchPolicy}`
  ];

  const left = [
    colorize("Overview", "bold"),
    colorize("────────", "gray"),
    ...actions.map((action, index) => selectableRow(index === state.selectedOverviewIndex, action, leftWidth))
  ];

  const recentTickets = state.tickets.slice(0, 5).map((ticket) => `${ticket.id.padEnd(3)} ${ticket.title}`);
  const recentExecutions = state.executions
    .slice(0, 5)
    .map((execution) => `${execution.id.padEnd(3)} ${execution.ticketId.padEnd(3)} ${execution.branchName}`);
  const right = [
    colorize("Repository Summary", "bold"),
    colorize("──────────────────", "gray"),
    `Project: ${state.config.project.name}`,
    `Branch: ${state.repositoryStatus.currentBranch}`,
    `Policy: ${state.config.execution.defaultBranchPolicy}`,
    "",
    colorize("Recent Tickets", "cyan"),
    ...(recentTickets.length > 0 ? recentTickets : [colorize("No tickets.", "gray")]),
    "",
    colorize("Recent Executions", "cyan"),
    ...(recentExecutions.length > 0 ? recentExecutions : [colorize("No executions.", "gray")])
  ];

  return combineColumns(left, right, leftWidth, rightWidth);
}

function renderTicketsPanel(state: DashboardState, width: number): string[] {
  const leftWidth = Math.min(42, Math.floor(width * 0.38));
  const rightWidth = width - leftWidth - 3;
  const left = [
    colorize("Tickets", "bold"),
    colorize("───────", "gray"),
    ...(state.tickets.length > 0
      ? state.tickets.map((ticket, index) =>
          selectableRow(
            index === state.selectedTicketIndex,
            `${ticket.id.padEnd(3)} ${ticket.title} ${colorize(`[${ticket.status}]`, "gray")}`,
            leftWidth
          )
        )
      : [colorize("No local tickets found.", "gray")])
  ];

  const ticket = state.tickets[state.selectedTicketIndex];
  const right = ticket ? renderTicketDetail(ticket, state, rightWidth) : [colorize("No ticket selected.", "gray")];
  return combineColumns(left, right, leftWidth, rightWidth);
}

function renderExecutionsPanel(state: DashboardState, width: number): string[] {
  const leftWidth = Math.min(44, Math.floor(width * 0.4));
  const rightWidth = width - leftWidth - 3;
  const left = [
    colorize("Executions", "bold"),
    colorize("──────────", "gray"),
    ...(state.executions.length > 0
      ? state.executions.map((execution, index) =>
          selectableRow(
            index === state.selectedExecutionIndex,
            `${execution.id.padEnd(3)} ${execution.ticketId.padEnd(3)} ${execution.branchName}`,
            leftWidth
          )
        )
      : [colorize("No local executions found.", "gray")])
  ];

  const execution = state.executionDetail ?? state.executions[state.selectedExecutionIndex];
  const right = execution ? renderExecutionDetail(execution, rightWidth) : [colorize("No execution selected.", "gray")];
  return combineColumns(left, right, leftWidth, rightWidth);
}

function renderSettingsPanel(state: DashboardState, width: number): string[] {
  return [
    colorize("Settings", "bold"),
    colorize("────────", "gray"),
    "",
    `${colorize("Project Policy", "gray")}  ${formatPolicy(state.projectBranchPolicy)}  ${colorize("(Enter to cycle)", "gray")}`,
    `${colorize("User Policy", "gray")}     ${formatPolicy(state.userBranchPolicy)}  ${colorize("(u to cycle)", "gray")}`,
    `${colorize("Effective", "gray")}        ${formatPolicy(state.config.execution.defaultBranchPolicy)}`,
    "",
    colorize("Branch Policy Notes", "cyan"),
    "- reuse-current uses the current feature branch when safe.",
    "- on the default branch, reuse-current resolves to a new isolated branch.",
    "- manual blocks execution until you override or change config.",
    "- none is for non-coding modes such as plan_only or review_only."
  ].map((line) => fitText(line, width));
}

function renderHelpPanel(width: number): string[] {
  return [
    colorize("Dashboard Shortcuts", "bold"),
    colorize("───────────────────", "gray"),
    "",
    `${colorize("Tab / h / l", "cyan")}   Switch panels`,
    `${colorize("Up / Down / j / k", "cyan")}  Move selection`,
    `${colorize("Enter", "cyan")}         Primary action for current panel`,
    `${colorize("r", "cyan")}             Refresh dashboard`,
    `${colorize("q / Esc", "cyan")}       Exit dashboard`,
    "",
    colorize("Tickets Panel", "bold"),
    `${colorize("c", "cyan")}             Load classification preview`,
    `${colorize("p", "cyan")}             Load prompt preview`,
    `${colorize("x", "cyan")}             Start execution and prepare branch`,
    "",
    colorize("Settings Panel", "bold"),
    `${colorize("Enter", "cyan")}         Cycle project branch policy`,
    `${colorize("u", "cyan")}             Cycle user branch policy`
  ].map((line) => fitText(line, width));
}

function renderTicketDetail(ticket: Ticket, state: DashboardState, width: number): string[] {
  const lines = [
    colorize(`Ticket ${ticket.id}`, "bold"),
    colorize("─────────", "gray"),
    `Title: ${ticket.title}`,
    `Source: ${ticket.source}`,
    `Labels: ${ticket.labels.length > 0 ? ticket.labels.join(", ") : "none"}`,
    `Description: ${ticket.description || "No description provided."}`,
    ""
  ];

  if (!state.ticketInspection || selectedTicketId(state) !== ticket.id) {
    lines.push(colorize("Press Enter or c to load classification.", "gray"));
    lines.push(colorize("Press p to load a prompt preview.", "gray"));
    return wrapLines(lines, width);
  }

  if (state.ticketInspection.mode === "classification" && state.ticketInspection.classification) {
    const detail = state.ticketInspection.classification;
    lines.push(colorize("Classification", "cyan"));
    lines.push(`Risk: ${detail.classification.risk}`);
    lines.push(`Complexity: ${detail.classification.complexity}`);
    lines.push(`Areas: ${detail.classification.affectedAreas.join(", ")}`);
    lines.push(`Profile: ${detail.classification.suggestedProfile}`);
    lines.push(`Mode: ${detail.classification.suggestedMode}`);
    lines.push(`Reason: ${detail.classification.reason}`);
    return wrapLines(lines, width);
  }

  if (state.ticketInspection.mode === "prompt" && state.ticketInspection.prompt) {
    lines.push(colorize("Prompt Preview", "cyan"));
    const preview = state.ticketInspection.prompt.prompt
      .split(/\r?\n/)
      .slice(0, 18)
      .join("\n");
    lines.push(preview);
    return wrapLines(lines, width);
  }

  return wrapLines(lines, width);
}

function renderExecutionDetail(execution: Execution, width: number): string[] {
  const lines = [
    colorize(`Execution ${execution.id}`, "bold"),
    colorize("────────────", "gray"),
    `Status: ${execution.status}`,
    `Ticket: ${execution.ticketId}`,
    `Branch: ${execution.branchName}`,
    `Profile: ${execution.profileId}`,
    `Model: ${execution.providerId}/${execution.modelId}`,
    `Created: ${execution.createdAt}`,
    "",
    colorize("Classification Snapshot", "cyan"),
    `Risk: ${execution.classificationSnapshot.risk}`,
    `Complexity: ${execution.classificationSnapshot.complexity}`,
    `Areas: ${execution.classificationSnapshot.affectedAreas.join(", ")}`,
    "",
    colorize("Logs", "cyan"),
    ...(execution.logs.length > 0 ? execution.logs : [colorize("No logs yet.", "gray")])
  ];

  return wrapLines(lines, width);
}

function renderTabs(active: PanelId, width: number): string {
  const items = PANELS.map((panel) => {
    const label = ` ${panel.toUpperCase()} `;
    return panel === active ? colorize(label, "inverse") : colorize(label, "gray");
  }).join(" ");

  return fitText(items, width);
}

function renderShortcutBar(active: PanelId, width: number): string {
  const base = ["Tab panels", "j/k move", "Enter action", "r refresh", "q exit"];
  const panelSpecific =
    active === "tickets"
      ? ["c classify", "p prompt", "x run"]
      : active === "settings"
        ? ["Enter project policy", "u user policy"]
        : active === "executions"
          ? ["Enter details"]
          : [];

  return fitText(colorize([...base, ...panelSpecific].join("  •  "), "gray"), width);
}

function renderMessageBar(message: DashboardMessage | undefined, width: number): string {
  if (!message) {
    return fitText(colorize("Ready.", "gray"), width);
  }

  const tone =
    message.tone === "success"
      ? "green"
      : message.tone === "warning"
        ? "yellow"
        : message.tone === "error"
          ? "red"
          : "blue";

  return fitText(`${colorize(message.tone.toUpperCase(), tone)} ${message.text}`, width);
}

function combineColumns(left: string[], right: string[], leftWidth: number, rightWidth: number): string[] {
  const maxLines = Math.max(left.length, right.length);
  const lines: string[] = [];

  for (let index = 0; index < maxLines; index += 1) {
    const leftCell = padAnsi(left[index] ?? "", leftWidth);
    const rightCell = fitText(right[index] ?? "", rightWidth);
    lines.push(`${leftCell} ${colorize("│", "gray")} ${rightCell}`);
  }

  return lines;
}

function selectableRow(selected: boolean, value: string, width: number): string {
  const prefix = selected ? colorize("›", "magenta") : colorize(" ", "gray");
  const content = fitText(value, Math.max(0, width - 2));
  const row = `${prefix} ${content}`;
  return selected ? colorize(padAnsi(row, width), "inverse") : padAnsi(row, width);
}

function wrapLines(lines: string[], width: number): string[] {
  return lines.flatMap((line) => wrapLine(line, width));
}

function wrapLine(line: string, width: number): string[] {
  const plain = stripAnsi(line);

  if (plain.length <= width) {
    return [line];
  }

  const parts: string[] = [];
  let remaining = plain;

  while (remaining.length > width) {
    parts.push(remaining.slice(0, width));
    remaining = remaining.slice(width);
  }

  if (remaining) {
    parts.push(remaining);
  }

  return parts;
}

function fitText(value: string, width: number): string {
  const plain = stripAnsi(value);

  if (plain.length <= width) {
    return value;
  }

  if (width <= 1) {
    return plain.slice(0, width);
  }

  return `${plain.slice(0, width - 1)}…`;
}

function padAnsi(value: string, width: number): string {
  const plain = stripAnsi(value);
  return value + " ".repeat(Math.max(0, width - plain.length));
}

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-9;]*m/g, "");
}

function colorize(value: string, style: keyof typeof ANSI): string {
  return `${ANSI[style]}${value}${ANSI.reset}`;
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) {
    return -1;
  }

  return Math.max(0, Math.min(index, length - 1));
}

function selectedTicketId(state: DashboardState): string | undefined {
  return state.tickets[state.selectedTicketIndex]?.id;
}

function formatPolicy(value: ExecutionBranchPolicy | undefined): string {
  return value ? colorize(value, "blue") : colorize("(not set)", "gray");
}
