import { rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(scriptDir, "..");
const webDir = path.join(workspaceRoot, "apps", "web");
const nextCacheDir = path.join(webDir, ".next");

await rm(nextCacheDir, { recursive: true, force: true });

const child = spawn(
  "pnpm",
  ["--filter", "@opentop/web", "exec", "next", "dev", "--turbopack", "--port", "3000"],
  {
    cwd: workspaceRoot,
    env: process.env,
    stdio: "inherit"
  }
);

const forwardSignal = (signal) => {
  if (!child.killed) {
    child.kill(signal);
  }
};

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => forwardSignal(signal));
}

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
