import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { createIsolatedBranch, getGitHubRemoteInfo, getRepositoryStatus } from "./index.js";

const execFileAsync = promisify(execFile);

test("getRepositoryStatus ignores OpenTop state files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opentop-git-"));

  try {
    await initRepo(directory);
    await mkdir(join(directory, ".opentop", "state"), { recursive: true });
    await writeFile(join(directory, ".opentop", "state", "opentop.db"), "state");
    await writeFile(join(directory, "src.ts"), "export const value = 1;\n");

    const status = await getRepositoryStatus(directory);
    assert.equal(status.isClean, false);
    assert.deepEqual(status.changedFiles, ["src.ts"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("createIsolatedBranch creates a new local branch", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opentop-git-"));

  try {
    await initRepo(directory, true);
    await createIsolatedBranch("codex/test-branch", directory);
    const { stdout } = await execFileAsync("git", ["branch", "--show-current"], {
      cwd: directory
    });
    assert.equal(stdout.trim(), "codex/test-branch");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("getGitHubRemoteInfo parses HTTPS remotes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opentop-git-"));

  try {
    await initRepo(directory, true);
    await execFileAsync("git", ["remote", "add", "origin", "https://github.com/example/opentop.git"], {
      cwd: directory
    });

    const remote = await getGitHubRemoteInfo(directory);
    assert.equal(remote.repositoryFullName, "example/opentop");
    assert.equal(remote.owner, "example");
    assert.equal(remote.repo, "opentop");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

async function initRepo(directory: string, commitInitialFile = false): Promise<void> {
  await execFileAsync("git", ["init", "-b", "main"], { cwd: directory });
  await execFileAsync("git", ["config", "user.name", "OpenTop Test"], { cwd: directory });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: directory });

  if (commitInitialFile) {
    await writeFile(join(directory, "README.md"), "# temp\n");
    await execFileAsync("git", ["add", "README.md"], { cwd: directory });
    await execFileAsync("git", ["commit", "-m", "init"], { cwd: directory });
  }
}
