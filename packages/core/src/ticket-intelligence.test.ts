import test from "node:test";
import assert from "node:assert/strict";
import { createAiTicketIntelligenceService, resolveTicketIntelligence } from "./ticket-intelligence.js";
import type { OpenTopConfig } from "./config.js";
import type { ExecutionProvider } from "./repositories.js";
import type { ExecutionProviderRequest, ExecutionProviderResult, Ticket } from "./types.js";

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
      model: "gpt-5.4-mini"
    },
    strong: {
      provider: "remote",
      model: "gpt-5.5"
    }
  },
  agentProfiles: {
    test: {
      description: "Test profile",
      modelTier: "cheap",
      mode: "implement_and_test",
      requiresApproval: false,
      allowedCommands: []
    },
    feature: {
      description: "Feature profile",
      modelTier: "strong",
      mode: "plan_then_implement",
      requiresApproval: true,
      allowedCommands: []
    }
  },
  routing: {
    rules: [
      {
        when: {
          taskTypes: ["test"]
        },
        profile: "test"
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

const ticket: Ticket = {
  id: "2",
  source: "manual",
  title: "Branch-Kontext im Dashboard verständlicher machen",
  description:
    "Das Dashboard soll klarer zwischen aktuellem Arbeits-Branch, Default-Branch und gespeicherten Executions unterscheiden.",
  labels: ["ui", "ux", "test"],
  status: "inbox"
};

class FakeExecutionProvider implements ExecutionProvider {
  constructor(private readonly result: ExecutionProviderResult) {}

  async run(_request: ExecutionProviderRequest): Promise<ExecutionProviderResult> {
    return this.result;
  }
}

test("createAiTicketIntelligenceService parses JSON output into an assisted classification", async () => {
  const provider = new FakeExecutionProvider({
    success: true,
    summary: JSON.stringify({
      classification: {
        taskType: "test",
        risk: "low",
        complexity: "medium",
        affectedAreas: ["frontend", "tests"],
        detectedSignals: ["dashboard copy", "branch context"],
        suggestedProfile: "test",
        suggestedModelTier: "cheap",
        suggestedMode: "implement_and_test",
        approvalRequired: false,
        reason: "This is lightweight UI clarification with a small test surface."
      },
      refinedBrief: {
        summary: "Clarify the board header so branch context is easier to understand.",
        objective: "Distinguish current branch, default branch, and execution history.",
        scope: ["Board header copy", "Small supporting explanation"],
        acceptanceCriteria: ["A new user can tell which branch is currently checked out."],
        constraints: ["Keep the dashboard compact."],
        openQuestions: []
      },
      confidence: "medium",
      missingInformation: []
    }),
    changedFiles: [],
    logs: []
  });

  const service = createAiTicketIntelligenceService({
    providerId: "local",
    model: "gpt-5.4-mini",
    executionProvider: provider
  });

  const result = await resolveTicketIntelligence({
    ticket,
    config,
    repositoryPath: "/tmp/opentop-sandbox",
    intelligenceService: service
  });

  assert.equal(result.classification.taskType, "test");
  assert.equal(result.classification.suggestedProfile, "test");
  assert.equal(result.classification.suggestedModelTier, "cheap");
  assert.equal(result.classification.suggestedProviderId, "local");
  assert.equal(result.classification.suggestedModel, "gpt-5.4-mini");
  assert.match(result.classification.reason, /AI-assisted classification/i);
  assert.equal(result.intelligenceSummary?.source, "ai_assisted");
  assert.equal(result.intelligenceSummary?.refinedBrief?.summary, "Clarify the board header so branch context is easier to understand.");
});
