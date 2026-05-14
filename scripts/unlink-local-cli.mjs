import { rm } from "node:fs/promises";
import { join } from "node:path";
import { env, platform } from "node:process";

if (platform !== "win32") {
  throw new Error("unlink-local-cli.mjs currently supports Windows only.");
}

const roaming = env.APPDATA;

if (!roaming) {
  throw new Error("APPDATA is not defined.");
}

const npmDirectory = join(roaming, "npm");
const targets = [join(npmDirectory, "opentop.ps1"), join(npmDirectory, "opentop.cmd")];

for (const target of targets) {
  await rm(target, { force: true });
  console.log(`Removed ${target}`);
}
