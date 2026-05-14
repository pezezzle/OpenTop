import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, parse as parsePath, resolve } from "node:path";
import { parse, stringify } from "yaml";
import { z } from "zod";
import type { ExecutionBranchPolicy } from "@opentop/shared";

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

const executionBranchPolicySchema = z.enum(["new", "reuse-current", "manual", "none"]);

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
  execution: z.object({
    defaultBranchPolicy: executionBranchPolicySchema.default("reuse-current")
  }),
  commands: z.record(z.string()).default({})
});

export type OpenTopConfig = z.infer<typeof openTopConfigSchema>;
export type OpenTopConfigScope = "effective" | "project" | "user";

export async function loadOpenTopConfig(path?: string, startDirectory = process.cwd()): Promise<OpenTopConfig> {
  const configPath = path ? resolve(path) : await findOpenTopConfig(startDirectory);
  const [userConfig, projectConfig] = await Promise.all([loadUserOpenTopConfig(), loadYamlFile(configPath)]);

  return openTopConfigSchema.parse(mergeConfigObjects(userConfig, projectConfig));
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

export function getProvider(config: OpenTopConfig, id: string) {
  const provider = config.providers[id];

  if (!provider) {
    throw new Error(`Provider "${id}" is not defined in OpenTop config.`);
  }

  return {
    id,
    ...provider
  };
}

export async function loadUserOpenTopConfig(): Promise<{ execution?: { defaultBranchPolicy?: ExecutionBranchPolicy } }> {
  const userConfigPath = getUserOpenTopConfigPath();
  const raw = await loadOptionalYamlFile(userConfigPath);

  const schema = z.object({
    execution: z
      .object({
        defaultBranchPolicy: executionBranchPolicySchema.optional()
      })
      .optional()
  });

  return schema.parse(raw ?? {});
}

export async function getBranchPolicySettings(startDirectory = process.cwd()): Promise<{
  effective: ExecutionBranchPolicy;
  project?: ExecutionBranchPolicy;
  user?: ExecutionBranchPolicy;
  projectConfigPath: string;
  userConfigPath: string;
}> {
  const [effectiveConfig, projectConfigPath, projectRawConfig, userConfig] = await Promise.all([
    loadOpenTopConfig(undefined, startDirectory),
    findOpenTopConfig(startDirectory),
    loadYamlFile(await findOpenTopConfig(startDirectory)),
    loadUserOpenTopConfig()
  ]);

  const project = readBranchPolicyValue(projectRawConfig);
  const user = userConfig.execution?.defaultBranchPolicy;

  return {
    effective: effectiveConfig.execution.defaultBranchPolicy,
    project,
    user,
    projectConfigPath,
    userConfigPath: getUserOpenTopConfigPath()
  };
}

export async function getConfigValue(
  key: "execution.defaultBranchPolicy",
  scope: OpenTopConfigScope,
  startDirectory = process.cwd()
): Promise<string | undefined> {
  if (scope === "effective") {
    const config = await loadOpenTopConfig(undefined, startDirectory);
    return config.execution.defaultBranchPolicy;
  }

  if (scope === "project") {
    const raw = await loadYamlFile(await findOpenTopConfig(startDirectory));
    return readBranchPolicyValue(raw);
  }

  const userConfig = await loadUserOpenTopConfig();
  return userConfig.execution?.defaultBranchPolicy;
}

export async function setConfigValue(
  key: "execution.defaultBranchPolicy",
  value: ExecutionBranchPolicy,
  scope: Exclude<OpenTopConfigScope, "effective">,
  startDirectory = process.cwd()
): Promise<string> {
  if (key !== "execution.defaultBranchPolicy") {
    throw new Error(`Unsupported config key "${key}".`);
  }

  const targetPath =
    scope === "project" ? await findOpenTopConfig(startDirectory) : getUserOpenTopConfigPath();
  const raw = (await loadOptionalYamlFile(targetPath)) ?? {};
  const nextConfig = setNestedValue(raw, ["execution", "defaultBranchPolicy"], value);

  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, stringify(nextConfig));
  return targetPath;
}

export function getUserOpenTopConfigPath(): string {
  return join(homedir(), ".opentop", "config.yml");
}

async function loadYamlFile(path: string): Promise<unknown> {
  const raw = await readFile(path, "utf8");
  return parse(raw) ?? {};
}

async function loadOptionalYamlFile(path: string): Promise<unknown | undefined> {
  try {
    return await loadYamlFile(path);
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }

    throw error;
  }
}

function mergeConfigObjects(userConfig: unknown, projectConfig: unknown): unknown {
  if (!isObject(userConfig)) {
    return projectConfig;
  }

  if (!isObject(projectConfig)) {
    return userConfig;
  }

  return {
    ...userConfig,
    ...projectConfig,
    execution: {
      ...(isObject(userConfig.execution) ? userConfig.execution : {}),
      ...(isObject(projectConfig.execution) ? projectConfig.execution : {})
    }
  };
}

function readBranchPolicyValue(raw: unknown): ExecutionBranchPolicy | undefined {
  if (!isObject(raw) || !isObject(raw.execution)) {
    return undefined;
  }

  const value = raw.execution.defaultBranchPolicy;
  return value === "new" || value === "reuse-current" || value === "manual" || value === "none"
    ? value
    : undefined;
}

function setNestedValue(root: unknown, path: readonly string[], value: unknown): Record<string, unknown> {
  const nextRoot = isObject(root) ? { ...root } : {};
  let cursor: Record<string, unknown> = nextRoot;

  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index];
    const current = cursor[segment];
    const next = isObject(current) ? { ...current } : {};
    cursor[segment] = next;
    cursor = next;
  }

  cursor[path[path.length - 1]] = value;
  return nextRoot;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "ENOENT"
  );
}
