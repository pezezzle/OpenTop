import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import type { AgentRunRequest, AgentRunResult, AiProviderAdapter } from "./types.js";
import { resolveExecutable } from "./command-resolution.js";

export interface CodexCliProviderOptions {
  command?: string;
  id?: string;
}

export class CodexCliProvider implements AiProviderAdapter {
  readonly id: string;
  private readonly command: string;

  constructor(options: CodexCliProviderOptions = {}) {
    this.id = options.id ?? "codex-cli";
    this.command = options.command ?? "codex";
  }

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    const logs: string[] = [];
    const outputDirectory = await mkdtemp(join(tmpdir(), "opentop-codex-"));
    const outputPath = join(outputDirectory, "last-message.txt");
    const executable = await resolveExecutable(this.command);
    const child = spawn(
      executable,
      [
        "exec",
        "--cd",
        request.repositoryPath,
        "--model",
        request.model,
        "--sandbox",
        "workspace-write",
        "--output-last-message",
        outputPath,
        "--color",
        "never",
        "-"
      ],
      {
        cwd: request.repositoryPath,
        env: process.env,
        shell: false,
        windowsHide: true
      }
    );

    child.stdout.on("data", (chunk) => logs.push(String(chunk)));
    child.stderr.on("data", (chunk) => logs.push(String(chunk)));
    child.stdin?.write(request.prompt);
    child.stdin?.end();

    const exitCode = await new Promise<number | null>((resolve) => {
      child.on("close", resolve);
    });

    let summary = exitCode === 0 ? "Codex provider completed successfully." : `Codex provider exited with code ${exitCode}.`;

    try {
      const lastMessage = (await readFile(outputPath, "utf8")).trim();
      if (lastMessage.length > 0) {
        summary = lastMessage;
      }
    } catch {
      // Keep the fallback summary if Codex did not write a final message file.
    }

    await rm(outputDirectory, { recursive: true, force: true });

    return {
      success: exitCode === 0,
      summary,
      changedFiles: [],
      logs
    };
  }
}
