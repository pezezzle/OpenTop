import { dirname, resolve } from "node:path";
import { platform } from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliDirectory = resolve(repoRoot, "apps", "cli");

await run("npm", ["link"], cliDirectory);

if (platform === "win32") {
  console.log("Linked OpenTop CLI through npm link (Windows global shim path).");
} else {
  console.log("Linked OpenTop CLI through npm link.");
}

console.log(`CLI package directory: ${cliDirectory}`);

function run(command, args, cwd) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      shell: platform === "win32"
    });

    child.on("error", rejectPromise);
    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      rejectPromise(new Error(`${command} ${args.join(" ")} exited with code ${code ?? 1}.`));
    });
  });
}
