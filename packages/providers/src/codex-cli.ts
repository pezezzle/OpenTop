import { CustomShellProvider } from "./custom-shell.js";

export interface CodexCliProviderOptions {
  command?: string;
}

export class CodexCliProvider extends CustomShellProvider {
  constructor(options: CodexCliProviderOptions = {}) {
    super({
      id: "codex-cli",
      command: options.command ?? "codex"
    });
  }
}
