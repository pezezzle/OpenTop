import { spawn } from "node:child_process";
import type { AgentRunRequest, AgentRunResult, AiProviderAdapter } from "./types.js";

export interface CustomShellProviderOptions {
  id?: string;
  command: string;
  args?: string[];
}

export class CustomShellProvider implements AiProviderAdapter {
  readonly id: string;
  private readonly command: string;
  private readonly args: string[];

  constructor(options: CustomShellProviderOptions) {
    this.id = options.id ?? "custom-shell";
    this.command = options.command;
    this.args = options.args ?? [];
  }

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    const logs: string[] = [];
    const child = spawn(this.command, this.args, {
      cwd: request.repositoryPath,
      env: {
        ...process.env,
        OPENTOP_TICKET_TITLE: request.ticketTitle,
        OPENTOP_BRANCH_NAME: request.branchName,
        OPENTOP_AGENT_PROFILE: request.agentProfile,
        OPENTOP_MODEL: request.model,
        OPENTOP_EXECUTION_MODE: request.mode,
        OPENTOP_PROJECT_RULES: request.projectRules
      },
      shell: true
    });

    child.stdout.on("data", (chunk) => logs.push(String(chunk)));
    child.stderr.on("data", (chunk) => logs.push(String(chunk)));
    child.stdin?.write(request.prompt);
    child.stdin?.end();

    const exitCode = await new Promise<number | null>((resolve) => {
      child.on("close", resolve);
    });

    return {
      success: exitCode === 0,
      summary: exitCode === 0 ? "Shell provider completed successfully." : `Shell provider exited with code ${exitCode}.`,
      changedFiles: [],
      logs
    };
  }
}
