import { access, readFile } from "node:fs/promises";
import { dirname, join, parse as parsePath, resolve } from "node:path";
import { parse } from "yaml";
import { z } from "zod";

const providerSchema = z.object({
  type: z.string(),
  command: z.string().optional(),
  apiKeyEnv: z.string().optional()
});

const modelSchema = z.object({
  provider: z.string(),
  model: z.string()
});

const agentProfileSchema = z.object({
  description: z.string().optional(),
  modelTier: z.string(),
  mode: z.enum([
    "plan_only",
    "implement_only",
    "implement_and_test",
    "plan_then_implement",
    "review_only",
    "fix_build",
    "draft_pr"
  ]),
  requiresApproval: z.boolean().default(false),
  allowedCommands: z.array(z.string()).default([])
});

const routingRuleSchema = z.union([
  z.object({
    when: z.object({
      labels: z.array(z.string()).optional(),
      keywords: z.array(z.string()).optional()
    }),
    profile: z.string()
  }),
  z.object({
    default: z.object({
      profile: z.string()
    })
  })
]);

export const openTopConfigSchema = z.object({
  project: z.object({
    name: z.string(),
    defaultBranch: z.string().default("main")
  }),
  providers: z.record(providerSchema),
  models: z.record(modelSchema),
  agentProfiles: z.record(agentProfileSchema),
  routing: z.object({
    rules: z.array(routingRuleSchema)
  }),
  commands: z.record(z.string()).default({})
});

export type OpenTopConfig = z.infer<typeof openTopConfigSchema>;

export async function loadOpenTopConfig(path?: string, startDirectory = process.cwd()): Promise<OpenTopConfig> {
  const configPath = path ? resolve(path) : await findOpenTopConfig(startDirectory);
  const raw = await readFile(configPath, "utf8");
  return openTopConfigSchema.parse(parse(raw));
}

export async function findOpenTopConfig(startDirectory = process.cwd()): Promise<string> {
  let currentDirectory = resolve(startDirectory);
  const { root } = parsePath(currentDirectory);

  while (true) {
    const candidate = join(currentDirectory, ".opentop", "opentop.yml");

    try {
      await access(candidate);
      return candidate;
    } catch {
      if (currentDirectory === root) {
        throw new Error("Could not find .opentop/opentop.yml in the current directory or its parents.");
      }

      currentDirectory = dirname(currentDirectory);
    }
  }
}

export async function findOpenTopDirectory(startDirectory = process.cwd()): Promise<string> {
  return dirname(await findOpenTopConfig(startDirectory));
}

export function getAgentProfile(config: OpenTopConfig, id: string) {
  const profile = config.agentProfiles[id];

  if (!profile) {
    throw new Error(`Agent profile "${id}" is not defined in OpenTop config.`);
  }

  return {
    id,
    ...profile
  };
}

export function getModel(config: OpenTopConfig, tier: string) {
  const model = config.models[tier];

  if (!model) {
    throw new Error(`Model tier "${tier}" is not defined in OpenTop config.`);
  }

  return model;
}
