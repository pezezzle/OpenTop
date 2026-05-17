import test from "node:test";
import assert from "node:assert/strict";
import { buildAgentPrompt } from "./prompt-builder.js";
import type { OpenTopConfig } from "./config.js";
import type { OpenTopProjectContext, Ticket } from "./types.js";

const config: OpenTopConfig = {
  project: {
    name: "Context Playground",
    defaultBranch: "main"
  },
  providers: {
    local: {
      type: "codex-cli",
      connection: {
        method: "local_cli",
        command: "codex"
      }
    }
  },
  models: {
    cheap: {
      provider: "local",
      model: "gpt-5-codex"
    },
    strong: {
      provider: "local",
      model: "gpt-5-codex"
    }
  },
  agentProfiles: {
    feature: {
      description: "Feature profile",
      modelTier: "strong",
      mode: "plan_then_implement",
      requiresApproval: true,
      allowedCommands: ["pnpm test"]
    }
  },
  routing: {
    rules: [{ default: { profile: "feature" } }]
  },
  execution: {
    defaultBranchPolicy: "reuse-current"
  },
  context: {
    learnedProfiles: ["starter-kit"],
    userProfiles: ["ronny"],
    profileMode: "project-first",
    maxPromptProfileWords: 80,
    maxProfileSections: 3
  },
  commands: {}
};

const projectContext: OpenTopProjectContext = {
  rootDirectory: "/tmp/context-playground",
  projectContext: "## Project\nInternal operations tool.\n\n## Architectural Rules\n- Reuse existing services.\n\n## Agent Instructions\nStay conservative.",
  rules: "## Engineering Rules\n- Keep changes focused.\n\n## Safety Rules\n- Do not invent secrets.",
  memory: {
    conventions: "- Prefer service modules.\n- Keep forms compact."
  },
  prompts: {
    feature: "## Objective\nImplement the requested feature.\n\n## Rules\n- Preserve existing UX patterns."
  },
  pullRequestTemplate: "# Summary\n# Risks",
  settings: config.context,
  activeProfiles: [
    {
      id: "starter-kit",
      type: "learned-project",
      displayName: "Starter Kit",
      sourcePath: "/Users/example/.opentop/profiles/starter-kit",
      promptBudget: {
        maxProfileSections: 2,
        maxProfileWords: 60
      },
      sections: {
        summary: "This profile captures conventions for compact internal tooling.",
        "ui-style": "Prefer compact business UI, predictable navigation, and restrained visual treatment.",
        forms: "Use inline validation and keep submit/cancel actions in stable positions.",
        "testing-preferences": "Add focused tests when behavior changes."
      }
    },
    {
      id: "ronny",
      type: "user",
      displayName: "Ronny",
      sourcePath: "/Users/example/.opentop/user-profiles/ronny",
      promptBudget: {},
      sections: {
        "developer-style": "Prefer explicit naming and keep code easy to scan.",
        "prompt-preferences": "Mention affected files and remaining risks."
      }
    }
  ]
};

const ticket: Ticket = {
  id: "ticket-1",
  source: "manual",
  title: "Build customer feedback form",
  description: "Add a React form with validation and tests.",
  labels: ["feature"],
  status: "inbox"
};

test("buildAgentPrompt includes active profile influences within budget", () => {
  const built = buildAgentPrompt({
    ticket,
    config,
    projectContext
  });

  assert.equal(built.contextSummary.profileMode, "project-first");
  assert.equal(built.contextSummary.activeProfiles.length, 2);
  assert.ok(built.contextSummary.includedSections.some((entry) => entry.includes("Starter Kit")));
  assert.ok(built.contextSummary.influences.some((entry) => entry.includes("profile")));
  assert.ok(built.contextSummary.budget.usedProfileSections <= built.contextSummary.budget.maxProfileSections);
  assert.ok(built.contextSummary.budget.usedProfileWords <= built.contextSummary.budget.maxPromptProfileWords);
  assert.match(built.prompt, /Selected Context Profile Guidance/);
  assert.match(built.prompt, /Profile mode: project-first/);
});
