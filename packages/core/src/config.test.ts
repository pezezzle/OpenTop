import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadOpenTopConfig } from "./config.js";

test("loadOpenTopConfig backfills missing standard routing rules and agent profiles", async () => {
  const root = await mkdtemp(join(tmpdir(), "opentop-config-"));
  const previousHome = process.env.HOME;
  process.env.HOME = root;

  try {
    const opentopDir = join(root, ".opentop");
    await mkdir(opentopDir, { recursive: true });
    await writeFile(
      join(opentopDir, "opentop.yml"),
      `
project:
  name: Sandbox
  defaultBranch: main
providers:
  openaiCodex:
    type: openai-codex
    connection:
      method: oauth
      oauthProvider: openai-codex
models:
  cheap:
    provider: openaiCodex
    model: gpt-5-codex
  strong:
    provider: openaiCodex
    model: gpt-5-codex
agentProfiles:
  feature:
    description: Standard feature work
    modelTier: cheap
    mode: plan_then_implement
    requiresApproval: true
    allowedCommands:
      - pnpm test
routing:
  rules:
    - default:
        profile: feature
commands:
  test: pnpm test
execution:
  defaultBranchPolicy: reuse-current
`,
      "utf8"
    );

    const config = await loadOpenTopConfig(undefined, root);
    const testRule = config.routing.rules.find(
      (rule) => "when" in rule && rule.when.taskTypes?.includes("test")
    );

    assert.ok(testRule);
    assert.equal("when" in testRule ? testRule.profile : undefined, "test");
    assert.ok(config.agentProfiles.test);
    assert.equal(config.agentProfiles.test.mode, "implement_and_test");
  } finally {
    process.env.HOME = previousHome;
    await rm(root, { recursive: true, force: true });
  }
});
