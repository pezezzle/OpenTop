import test from "node:test";
import assert from "node:assert/strict";
import { classifyTicket } from "./classifier.js";
import { createExecutionPlan } from "./execution.js";
import type { OpenTopConfig } from "./config.js";
import type { Ticket } from "./types.js";

const config: OpenTopConfig = {
  project: {
    name: "OpenTop Sandbox",
    defaultBranch: "main"
  },
  providers: {
    local: {
      type: "codex-cli",
      connection: {
        method: "local_cli",
        command: "codex"
      }
    },
    remote: {
      type: "openai-api",
      connection: {
        method: "api_key",
        apiKeyEnv: "OPENAI_API_KEY"
      }
    }
  },
  models: {
    cheap: {
      provider: "local",
      model: "gpt-5-codex"
    },
    strong: {
      provider: "remote",
      model: "gpt-5"
    }
  },
  agentProfiles: {
    bugfix: {
      description: "Bugfix",
      modelTier: "cheap",
      mode: "implement_and_test",
      requiresApproval: false,
      allowedCommands: []
    },
    docs: {
      description: "Docs",
      modelTier: "cheap",
      mode: "implement_only",
      requiresApproval: false,
      allowedCommands: []
    },
    test: {
      description: "Test",
      modelTier: "cheap",
      mode: "implement_and_test",
      requiresApproval: false,
      allowedCommands: []
    },
    refactor: {
      description: "Refactor",
      modelTier: "strong",
      mode: "plan_then_implement",
      requiresApproval: true,
      allowedCommands: []
    },
    feature: {
      description: "Feature",
      modelTier: "strong",
      mode: "plan_then_implement",
      requiresApproval: true,
      allowedCommands: []
    },
    architecture: {
      description: "Architecture",
      modelTier: "strong",
      mode: "plan_only",
      requiresApproval: true,
      allowedCommands: []
    }
  },
  routing: {
    rules: [
      {
        when: {
          taskTypes: ["bugfix"]
        },
        profile: "bugfix"
      },
      {
        when: {
          taskTypes: ["docs"]
        },
        profile: "docs"
      },
      {
        when: {
          taskTypes: ["test"]
        },
        profile: "test"
      },
      {
        when: {
          taskTypes: ["refactor"]
        },
        profile: "refactor"
      },
      {
        when: {
          taskTypes: ["architecture", "security", "migration"]
        },
        profile: "architecture"
      },
      {
        default: {
          profile: "feature"
        }
      }
    ]
  },
  execution: {
    defaultBranchPolicy: "reuse-current"
  },
  context: {
    learnedProfiles: [],
    userProfiles: [],
    profileMode: "project-first",
    maxPromptProfileWords: 900,
    maxProfileSections: 6
  },
  commands: {}
};

function createTicket(input: Partial<Ticket> & Pick<Ticket, "id" | "title">): Ticket {
  return {
    id: input.id,
    source: "manual",
    title: input.title,
    description: input.description ?? "",
    labels: input.labels ?? [],
    status: "inbox"
  };
}

test("classifyTicket identifies docs work and routes it to the docs profile", () => {
  const classification = classifyTicket(
    createTicket({
      id: "docs-1",
      title: "Update README for provider setup",
      description: "Refresh the documentation and changelog for macOS install steps.",
      labels: ["docs"]
    }),
    config
  );

  assert.equal(classification.taskType, "docs");
  assert.equal(classification.suggestedProfile, "docs");
  assert.equal(classification.suggestedModelTier, "cheap");
  assert.equal(classification.suggestedProviderId, "local");
  assert.equal(classification.suggestedMode, "implement_only");
  assert.equal(classification.approvalRequired, false);
});

test("classifyTicket marks security work as high risk and review-first", () => {
  const classification = classifyTicket(
    createTicket({
      id: "security-1",
      title: "Review RBAC permission checks",
      description: "Tighten auth and permission handling around admin routes.",
      labels: ["security"]
    }),
    config
  );

  assert.equal(classification.taskType, "security");
  assert.equal(classification.risk, "high");
  assert.equal(classification.suggestedProfile, "architecture");
  assert.equal(classification.suggestedMode, "plan_only");
  assert.equal(classification.approvalRequired, true);
  assert.match(classification.reason, /high risk/i);
});

test("classifyTicket does not treat oauth provider wording as a security ticket when labels point to test work", () => {
  const classification = classifyTicket(
    createTicket({
      id: "oauth-1",
      title: "Test OpenAI Codex OAuth provider",
      description: "Create a short reviewable implementation suggestion for a harmless UI wording change.",
      labels: ["test"]
    }),
    config
  );

  assert.equal(classification.taskType, "test");
  assert.equal(classification.risk, "low");
  assert.equal(classification.complexity, "medium");
  assert.equal(classification.suggestedProfile, "test");
  assert.equal(classification.approvalRequired, false);
});

test("createExecutionPlan prefers a local-workspace provider for implementation-capable bugfix work", () => {
  const ticket = createTicket({
    id: "bug-1",
    title: "Fix failing settings button state",
    description: "Bug in the React settings screen causes a failing click path.",
    labels: ["bug", "ui"]
  });
  const plan = createExecutionPlan(ticket, config);

  assert.equal(plan.classification.taskType, "bugfix");
  assert.equal(plan.providerId, "local");
  assert.equal(plan.modelId, "gpt-5-codex");
  assert.equal(plan.profile.mode, "implement_and_test");
});

test("createExecutionPlan keeps strong planning work on the stronger structured-output provider", () => {
  const ticket = createTicket({
    id: "feature-1",
    title: "Implement a multi-step billing workflow",
    description: "Build a new feature with API, queue, frontend, and orchestration changes.",
    labels: ["feature"]
  });
  const plan = createExecutionPlan(ticket, config);

  assert.equal(plan.classification.taskType, "feature");
  assert.equal(plan.classification.complexity, "high");
  assert.equal(plan.providerId, "remote");
  assert.equal(plan.profile.mode, "plan_then_implement");
});
