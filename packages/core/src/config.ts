import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, parse as parsePath, resolve } from "node:path";
import { parse, stringify } from "yaml";
import { z } from "zod";
import type { ComplexityLevel, ExecutionBranchPolicy, ExecutionMode, RiskLevel } from "@opentop/shared";
import type { ContextProfileMode, ContextSettings, TaskCategory } from "./types.js";

export const providerConnectionMethodSchema = z.enum([
  "local_cli",
  "api_key",
  "oauth",
  "custom_command",
  "local_model"
]);

const providerConnectionSchema = z.object({
  method: providerConnectionMethodSchema,
  command: z.string().optional(),
  apiKeyEnv: z.string().optional(),
  oauthProvider: z.string().optional(),
  baseUrl: z.string().optional()
});

const providerSchema = z.preprocess(
  normalizeProviderInput,
  z.object({
    type: z.string(),
    connection: providerConnectionSchema,
    command: z.string().optional(),
    apiKeyEnv: z.string().optional(),
    oauthProvider: z.string().optional(),
    baseUrl: z.string().optional()
  })
);

const modelSchema = z.object({
  provider: z.string(),
  model: z.string()
});

const taskCategorySchema = z.enum([
  "bugfix",
  "small_change",
  "feature",
  "architecture",
  "refactor",
  "test",
  "docs",
  "security",
  "migration",
  "integration"
] satisfies [TaskCategory, ...TaskCategory[]]);

const riskLevelSchema = z.enum(["low", "medium", "high", "critical"] satisfies [RiskLevel, ...RiskLevel[]]);
const complexityLevelSchema = z.enum(["low", "medium", "high"] satisfies [ComplexityLevel, ...ComplexityLevel[]]);
const executionModeSchema = z.enum([
  "plan_only",
  "implement_only",
  "implement_and_test",
  "plan_then_implement",
  "review_only",
  "fix_build",
  "draft_pr"
] satisfies [ExecutionMode, ...ExecutionMode[]]);

const agentProfileSchema = z.object({
  description: z.string().optional(),
  modelTier: z.string(),
  mode: executionModeSchema,
  requiresApproval: z.boolean().default(false),
  allowedCommands: z.array(z.string()).default([])
});

const executionBranchPolicySchema = z.enum(["new", "reuse-current", "manual", "none"]);
const contextProfileModeSchema = z.enum([
  "project-first",
  "profile-first",
  "project-only",
  "profile-only",
  "manual"
] satisfies [ContextProfileMode, ...ContextProfileMode[]]);

const contextSettingsSchema = z.object({
  learnedProfiles: z.array(z.string()).default([]),
  userProfiles: z.array(z.string()).default([]),
  profileMode: contextProfileModeSchema.default("project-first"),
  maxPromptProfileWords: z.number().int().positive().default(900),
  maxProfileSections: z.number().int().positive().default(6)
});

const routingActionSchema = z.object({
  profile: z.string().optional(),
  modelTier: z.string().optional(),
  mode: executionModeSchema.optional(),
  requiresApproval: z.boolean().optional()
});

const routingRuleSchema = z.union([
  z.object({
    when: z.object({
      labels: z.array(z.string()).optional(),
      keywords: z.array(z.string()).optional(),
      taskTypes: z.array(taskCategorySchema).optional(),
      risk: z.array(riskLevelSchema).optional(),
      complexity: z.array(complexityLevelSchema).optional(),
      affectedAreas: z.array(z.string()).optional()
    }),
    profile: z.string().optional(),
    modelTier: z.string().optional(),
    mode: executionModeSchema.optional(),
    requiresApproval: z.boolean().optional()
  }),
  z.object({
    default: routingActionSchema.extend({
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
  context: contextSettingsSchema.default(defaultContextSettings()),
  commands: z.record(z.string()).default({})
});

export type OpenTopConfig = z.infer<typeof openTopConfigSchema>;
export type OpenTopConfigScope = "effective" | "project" | "user";
export type OpenTopProviderConfig = z.infer<typeof providerSchema>;
export type OpenTopModelConfig = z.infer<typeof modelSchema>;
export type ProviderConnectionMethod = z.infer<typeof providerConnectionMethodSchema>;

export interface ProviderSetupInput {
  providerId: string;
  type: string;
  connectionMethod: ProviderConnectionMethod;
  command?: string;
  apiKeyEnv?: string;
  oauthProvider?: string;
  baseUrl?: string;
  modelMappings?: Partial<Record<string, string>>;
}

export interface ContextSettingsInput {
  learnedProfiles: string[];
  userProfiles: string[];
  profileMode: ContextProfileMode;
  maxPromptProfileWords: number;
  maxProfileSections: number;
}

export async function loadOpenTopConfig(path?: string, startDirectory = process.cwd()): Promise<OpenTopConfig> {
  const configPath = path ? resolve(path) : await findOpenTopConfig(startDirectory);
  const [userConfig, projectConfig] = await Promise.all([loadUserOpenTopConfig(), loadYamlFile(configPath)]);

  return applyOpenTopConfigDefaults(openTopConfigSchema.parse(mergeConfigObjects(userConfig, projectConfig)));
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

export async function loadUserOpenTopConfig(): Promise<{
  execution?: { defaultBranchPolicy?: ExecutionBranchPolicy };
  context?: Partial<ContextSettings>;
}> {
  const userConfigPath = getUserOpenTopConfigPath();
  const raw = await loadOptionalYamlFile(userConfigPath);

  const schema = z.object({
    execution: z
      .object({
        defaultBranchPolicy: executionBranchPolicySchema.optional()
      })
      .optional(),
    context: contextSettingsSchema.partial().optional()
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
  key: "execution.defaultBranchPolicy" | "context.profileMode",
  scope: OpenTopConfigScope,
  startDirectory = process.cwd()
): Promise<string | undefined> {
  if (scope === "effective") {
    const config = await loadOpenTopConfig(undefined, startDirectory);
    return key === "execution.defaultBranchPolicy" ? config.execution.defaultBranchPolicy : config.context.profileMode;
  }

  if (scope === "project") {
    const raw = await loadYamlFile(await findOpenTopConfig(startDirectory));
    return key === "execution.defaultBranchPolicy" ? readBranchPolicyValue(raw) : readContextProfileModeValue(raw);
  }

  const userConfig = await loadUserOpenTopConfig();
  return key === "execution.defaultBranchPolicy"
    ? userConfig.execution?.defaultBranchPolicy
    : userConfig.context?.profileMode;
}

export async function getContextSettingsScopes(startDirectory = process.cwd()): Promise<{
  effective: ContextSettings;
  project: Partial<ContextSettings> | null;
  user: Partial<ContextSettings> | null;
}> {
  const [effectiveConfig, projectRawConfig, userConfig] = await Promise.all([
    loadOpenTopConfig(undefined, startDirectory),
    loadYamlFile(await findOpenTopConfig(startDirectory)),
    loadUserOpenTopConfig()
  ]);

  return {
    effective: effectiveConfig.context,
    project: readContextSettingsFromRaw(projectRawConfig),
    user: userConfig.context ?? null
  };
}

export async function setConfigValue(
  key: "execution.defaultBranchPolicy" | "context.profileMode",
  value:
    | ExecutionBranchPolicy
    | "project-first"
    | "profile-first"
    | "project-only"
    | "profile-only"
    | "manual",
  scope: Exclude<OpenTopConfigScope, "effective">,
  startDirectory = process.cwd()
): Promise<string> {
  if (key !== "execution.defaultBranchPolicy" && key !== "context.profileMode") {
    throw new Error(`Unsupported config key "${key}".`);
  }

  const targetPath =
    scope === "project" ? await findOpenTopConfig(startDirectory) : getUserOpenTopConfigPath();
  const raw = (await loadOptionalYamlFile(targetPath)) ?? {};
  const nextConfig =
    key === "execution.defaultBranchPolicy"
      ? setNestedValue(raw, ["execution", "defaultBranchPolicy"], value)
      : setNestedValue(raw, ["context", "profileMode"], value);

  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, stringify(nextConfig));
  return targetPath;
}

export async function saveContextSettings(
  input: ContextSettingsInput,
  scope: Exclude<OpenTopConfigScope, "effective">,
  startDirectory = process.cwd()
): Promise<string> {
  const targetPath =
    scope === "project" ? await resolveProjectConfigPath(startDirectory) : getUserOpenTopConfigPath();
  const raw = ((await loadOptionalYamlFile(targetPath)) ?? {}) as Record<string, unknown>;
  const nextConfig = isObject(raw) ? { ...raw } : {};
  nextConfig.context = {
    learnedProfiles: input.learnedProfiles,
    userProfiles: input.userProfiles,
    profileMode: input.profileMode,
    maxPromptProfileWords: input.maxPromptProfileWords,
    maxProfileSections: input.maxProfileSections
  };

  if (scope === "project") {
    nextConfig.project = isObject(nextConfig.project)
      ? {
          name:
            typeof nextConfig.project.name === "string" && nextConfig.project.name.trim().length > 0
              ? nextConfig.project.name
              : deriveProjectName(startDirectory),
          defaultBranch:
            typeof nextConfig.project.defaultBranch === "string" && nextConfig.project.defaultBranch.trim().length > 0
              ? nextConfig.project.defaultBranch
              : "main"
        }
      : {
          name: deriveProjectName(startDirectory),
          defaultBranch: "main"
        };
    nextConfig.providers = isObject(nextConfig.providers) ? nextConfig.providers : {};
    nextConfig.models = isObject(nextConfig.models) ? nextConfig.models : {};
    nextConfig.agentProfiles = isObject(nextConfig.agentProfiles) ? nextConfig.agentProfiles : defaultAgentProfiles();
    nextConfig.routing = isObject(nextConfig.routing) ? nextConfig.routing : defaultRouting();
    nextConfig.commands = isObject(nextConfig.commands) ? nextConfig.commands : defaultCommands();
    nextConfig.execution = isObject(nextConfig.execution)
      ? {
          defaultBranchPolicy:
            typeof nextConfig.execution.defaultBranchPolicy === "string"
              ? nextConfig.execution.defaultBranchPolicy
              : "reuse-current"
        }
      : {
          defaultBranchPolicy: "reuse-current"
        };
  }

  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, stringify(nextConfig));
  return targetPath;
}

export async function saveProviderSetup(
  input: ProviderSetupInput,
  startDirectory = process.cwd()
): Promise<string> {
  const targetPath = await resolveProjectConfigPath(startDirectory);
  const raw = ((await loadOptionalYamlFile(targetPath)) ?? createStarterConfigObject(deriveProjectName(startDirectory))) as Record<
    string,
    unknown
  >;
  const nextConfig = isObject(raw) ? { ...raw } : {};
  const providers = isObject(nextConfig.providers) ? { ...nextConfig.providers } : {};
  const models = isObject(nextConfig.models) ? { ...nextConfig.models } : {};

  providers[input.providerId] = serializeProviderSetup(input);
  nextConfig.providers = providers;
  nextConfig.models = updateModelMappings(models, input.providerId, input.modelMappings ?? {});
  nextConfig.project = isObject(nextConfig.project)
    ? {
        name:
          typeof nextConfig.project.name === "string" && nextConfig.project.name.trim().length > 0
            ? nextConfig.project.name
            : deriveProjectName(startDirectory),
        defaultBranch:
          typeof nextConfig.project.defaultBranch === "string" && nextConfig.project.defaultBranch.trim().length > 0
            ? nextConfig.project.defaultBranch
            : "main"
      }
    : {
        name: deriveProjectName(startDirectory),
        defaultBranch: "main"
      };
  nextConfig.agentProfiles = isObject(nextConfig.agentProfiles)
    ? nextConfig.agentProfiles
    : defaultAgentProfiles();
  nextConfig.routing = isObject(nextConfig.routing) ? nextConfig.routing : defaultRouting();
  nextConfig.commands = isObject(nextConfig.commands) ? nextConfig.commands : defaultCommands();
  nextConfig.execution = isObject(nextConfig.execution)
    ? {
        defaultBranchPolicy:
          typeof nextConfig.execution.defaultBranchPolicy === "string"
            ? nextConfig.execution.defaultBranchPolicy
            : "reuse-current"
      }
    : {
        defaultBranchPolicy: "reuse-current"
      };

  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, stringify(nextConfig));
  return targetPath;
}

export function createStarterConfigObject(projectName = "OpenTop"): Record<string, unknown> {
  return {
    project: {
      name: projectName,
      defaultBranch: "main"
    },
    providers: {},
    models: {},
    agentProfiles: defaultAgentProfiles(),
    routing: defaultRouting(),
    commands: defaultCommands(),
    execution: {
      defaultBranchPolicy: "reuse-current"
    },
    context: defaultContextSettings()
  };
}

export function stringifyStarterConfig(config: Record<string, unknown>): string {
  return stringify(config);
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
    },
    context: {
      ...defaultContextSettings(),
      ...(isObject(userConfig.context) ? userConfig.context : {}),
      ...(isObject(projectConfig.context) ? projectConfig.context : {})
    }
  };
}

async function resolveProjectConfigPath(startDirectory: string): Promise<string> {
  try {
    return await findOpenTopConfig(startDirectory);
  } catch {
    return join(resolve(startDirectory), ".opentop", "opentop.yml");
  }
}

function serializeProviderSetup(input: ProviderSetupInput): Record<string, unknown> {
  const connection: Record<string, unknown> = {
    method: input.connectionMethod
  };

  if (input.command) {
    connection.command = input.command;
  }

  if (input.apiKeyEnv) {
    connection.apiKeyEnv = input.apiKeyEnv;
  }

  if (input.oauthProvider) {
    connection.oauthProvider = input.oauthProvider;
  }

  if (input.baseUrl) {
    connection.baseUrl = input.baseUrl;
  }

  return {
    type: input.type,
    connection
  };
}

function updateModelMappings(
  rawModels: Record<string, unknown>,
  providerId: string,
  mappings: Partial<Record<string, string>>
): Record<string, unknown> {
  const nextModels = { ...rawModels };

  for (const [tier, model] of Object.entries(mappings)) {
    if (!model || model.trim().length === 0) {
      continue;
    }

    nextModels[tier] = {
      provider: providerId,
      model: model.trim()
    };
  }

  return nextModels;
}

function defaultAgentProfiles(): Record<string, unknown> {
  return {
    bugfix: {
      description: "Small isolated bug fixes",
      modelTier: "cheap",
      mode: "implement_and_test",
      requiresApproval: false,
      allowedCommands: ["pnpm test", "pnpm build"]
    },
    docs: {
      description: "Documentation and content updates",
      modelTier: "cheap",
      mode: "implement_only",
      requiresApproval: false,
      allowedCommands: ["pnpm build"]
    },
    test: {
      description: "Test creation and coverage improvements",
      modelTier: "cheap",
      mode: "implement_and_test",
      requiresApproval: false,
      allowedCommands: ["pnpm test", "pnpm build"]
    },
    refactor: {
      description: "Scoped refactors and cleanup work",
      modelTier: "strong",
      mode: "plan_then_implement",
      requiresApproval: true,
      allowedCommands: ["pnpm test", "pnpm build"]
    },
    feature: {
      description: "Standard feature implementation",
      modelTier: "strong",
      mode: "plan_then_implement",
      requiresApproval: true,
      allowedCommands: ["pnpm test", "pnpm build"]
    },
    architecture: {
      description: "High-risk architecture decisions",
      modelTier: "strong",
      mode: "plan_only",
      requiresApproval: true,
      allowedCommands: ["pnpm test", "pnpm build"]
    }
  };
}

function defaultRouting(): Record<string, unknown> {
  return {
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
  };
}

function defaultCommands(): Record<string, unknown> {
  return {
    test: "pnpm test",
    build: "pnpm build"
  };
}

function defaultContextSettings(): ContextSettings {
  return {
    learnedProfiles: [],
    userProfiles: [],
    profileMode: "project-first",
    maxPromptProfileWords: 900,
    maxProfileSections: 6
  };
}

function deriveProjectName(startDirectory: string): string {
  const name = basename(resolve(startDirectory));
  return name.length > 0 ? name : "OpenTop Project";
}

function readContextProfileModeValue(raw: unknown): ContextProfileMode | undefined {
  if (!isObject(raw) || !isObject(raw.context) || typeof raw.context.profileMode !== "string") {
    return undefined;
  }

  return raw.context.profileMode as ContextProfileMode;
}

function readContextSettingsFromRaw(raw: unknown): Partial<ContextSettings> | null {
  if (!isObject(raw) || !isObject(raw.context)) {
    return null;
  }

  const context = raw.context;
  return {
    learnedProfiles: Array.isArray(context.learnedProfiles) ? context.learnedProfiles.filter(isString) : [],
    userProfiles: Array.isArray(context.userProfiles) ? context.userProfiles.filter(isString) : [],
    profileMode: typeof context.profileMode === "string" ? (context.profileMode as ContextProfileMode) : undefined,
    maxPromptProfileWords:
      typeof context.maxPromptProfileWords === "number" ? context.maxPromptProfileWords : undefined,
    maxProfileSections: typeof context.maxProfileSections === "number" ? context.maxProfileSections : undefined
  };
}

function normalizeProviderInput(raw: unknown): unknown {
  if (!isObject(raw)) {
    return raw;
  }

  const type = typeof raw.type === "string" ? raw.type : "";
  const existingConnection = isObject(raw.connection) ? raw.connection : undefined;
  const connection =
    existingConnection !== undefined
      ? {
          ...existingConnection
        }
      : {
          method: inferConnectionMethod(type, raw),
          ...(typeof raw.command === "string" ? { command: raw.command } : {}),
          ...(typeof raw.apiKeyEnv === "string" ? { apiKeyEnv: raw.apiKeyEnv } : {}),
          ...(typeof raw.oauthProvider === "string" ? { oauthProvider: raw.oauthProvider } : {}),
          ...(typeof raw.baseUrl === "string" ? { baseUrl: raw.baseUrl } : {})
        };

  return {
    ...raw,
    connection,
    command:
      typeof raw.command === "string"
        ? raw.command
        : typeof connection.command === "string"
          ? connection.command
          : undefined,
    apiKeyEnv:
      typeof raw.apiKeyEnv === "string"
        ? raw.apiKeyEnv
        : typeof connection.apiKeyEnv === "string"
          ? connection.apiKeyEnv
          : undefined,
    oauthProvider:
      typeof raw.oauthProvider === "string"
        ? raw.oauthProvider
        : typeof connection.oauthProvider === "string"
          ? connection.oauthProvider
          : undefined,
    baseUrl:
      typeof raw.baseUrl === "string"
        ? raw.baseUrl
        : typeof connection.baseUrl === "string"
          ? connection.baseUrl
          : undefined
  };
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function inferConnectionMethod(type: string, raw: Record<string, unknown>): ProviderConnectionMethod {
  if (typeof raw.apiKeyEnv === "string") {
    return "api_key";
  }

  if (typeof raw.oauthProvider === "string") {
    return "oauth";
  }

  if (type === "custom-shell") {
    return "custom_command";
  }

  if (type === "ollama" || type === "lmstudio") {
    return "local_model";
  }

  return "local_cli";
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

function applyOpenTopConfigDefaults(config: OpenTopConfig): OpenTopConfig {
  return {
    ...config,
    agentProfiles: {
      ...typedDefaultAgentProfiles(),
      ...config.agentProfiles
    },
    routing: {
      rules: withDefaultRoutingRules(config.routing.rules)
    },
    commands: {
      ...typedDefaultCommands(),
      ...config.commands
    }
  };
}

function withDefaultRoutingRules(rules: OpenTopConfig["routing"]["rules"]): OpenTopConfig["routing"]["rules"] {
  const defaultRule = rules.find((rule) => "default" in rule);
  const nonDefaultRules = rules.filter((rule) => !("default" in rule));
  const coveredTaskTypes = new Set(
    nonDefaultRules.flatMap((rule) => ("when" in rule ? (rule.when.taskTypes ?? []) : []))
  );

  const normalizedRules = [...nonDefaultRules];

  if (!coveredTaskTypes.has("bugfix")) {
    normalizedRules.push({
      when: {
        taskTypes: ["bugfix"]
      },
      profile: "bugfix"
    });
  }

  if (!coveredTaskTypes.has("docs")) {
    normalizedRules.push({
      when: {
        taskTypes: ["docs"]
      },
      profile: "docs"
    });
  }

  if (!coveredTaskTypes.has("test")) {
    normalizedRules.push({
      when: {
        taskTypes: ["test"]
      },
      profile: "test"
    });
  }

  if (!coveredTaskTypes.has("refactor")) {
    normalizedRules.push({
      when: {
        taskTypes: ["refactor"]
      },
      profile: "refactor"
    });
  }

  if (
    !coveredTaskTypes.has("architecture") &&
    !coveredTaskTypes.has("security") &&
    !coveredTaskTypes.has("migration")
  ) {
    normalizedRules.push({
      when: {
        taskTypes: ["architecture", "security", "migration"]
      },
      profile: "architecture"
    });
  }

  if (defaultRule) {
    normalizedRules.push(defaultRule);
  } else {
    normalizedRules.push({
      default: {
        profile: "feature"
      }
    });
  }

  return normalizedRules;
}

function typedDefaultAgentProfiles(): OpenTopConfig["agentProfiles"] {
  return z.record(agentProfileSchema).parse(defaultAgentProfiles());
}

function typedDefaultCommands(): OpenTopConfig["commands"] {
  return z.record(z.string()).parse(defaultCommands());
}
