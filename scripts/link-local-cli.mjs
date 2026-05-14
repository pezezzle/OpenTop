import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { env, platform } from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(repoRoot, "apps", "cli", "dist", "index.js");

if (platform !== "win32") {
  throw new Error("link-local-cli.mjs currently supports Windows only.");
}

const roaming = env.APPDATA;

if (!roaming) {
  throw new Error("APPDATA is not defined.");
}

const npmDirectory = join(roaming, "npm");
await mkdir(npmDirectory, { recursive: true });

const ps1Path = join(npmDirectory, "opentop.ps1");
const cmdPath = join(npmDirectory, "opentop.cmd");

const ps1 = `#!/usr/bin/env pwsh
$target = "${toWindowsPath(target)}"
$ret = 0

if ($MyInvocation.ExpectingInput) {
  $input | & node $target $args
} else {
  & node $target $args
}

$ret = $LASTEXITCODE
exit $ret
`;

const cmd = `@ECHO off
SETLOCAL
SET "_prog=node"
"%_prog%" "${toWindowsPath(target)}" %*
`;

await writeFile(ps1Path, ps1);
await writeFile(cmdPath, cmd);

console.log(`Linked OpenTop CLI to ${target}`);
console.log(`Updated ${ps1Path}`);
console.log(`Updated ${cmdPath}`);

function toWindowsPath(value) {
  return value.replaceAll("/", "\\");
}
