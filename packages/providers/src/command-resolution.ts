import { spawn } from "node:child_process";

export async function resolveExecutable(command: string): Promise<string> {
  if (process.platform !== "win32") {
    return command;
  }

  if (/[\\/]/u.test(command) || /\.[A-Za-z0-9]+$/u.test(command)) {
    return command;
  }

  const resolved = await resolveWithWhere(command);
  return resolved ?? command;
}

async function resolveWithWhere(command: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const stdout: string[] = [];
    const child = spawn("where.exe", [command], {
      shell: false,
      windowsHide: true
    });

    child.stdout.on("data", (chunk) => stdout.push(String(chunk)));
    child.on("error", () => resolve(undefined));
    child.on("close", (code) => {
      if (code !== 0) {
        resolve(undefined);
        return;
      }

      const lines = stdout
        .join("")
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean);
      const preferred =
        lines.find((line) => /\.exe$/iu.test(line)) ??
        lines.find((line) => /\.(cmd|bat)$/iu.test(line)) ??
        lines.find((line) => /\.ps1$/iu.test(line)) ??
        lines[0];
      resolve(preferred);
    });
  });
}
