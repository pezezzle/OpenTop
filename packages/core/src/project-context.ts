import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { parse } from "yaml";
import { findOpenTopDirectory, loadOpenTopConfig } from "./config.js";
import type { LoadedContextProfile, OpenTopProjectContext } from "./types.js";

const memoryFiles = ["decisions", "conventions", "risks", "glossary", "known-issues"] as const;
const promptFiles = ["bugfix", "feature", "planner", "reviewer"] as const;
const profileSectionFiles = [
  "summary",
  "developer-style",
  "architecture",
  "ui-style",
  "forms",
  "styling",
  "testing-preferences",
  "ticket-guidelines",
  "prompt-preferences"
] as const;

export async function loadOpenTopProjectContext(startDirectory = process.cwd()): Promise<OpenTopProjectContext> {
  const openTopDirectory = await findOpenTopDirectory(startDirectory);
  const config = await loadOpenTopConfig(undefined, startDirectory);
  const activeProfiles = await loadConfiguredContextProfiles(config.context);

  return {
    rootDirectory: dirname(openTopDirectory),
    projectContext: await readOptionalFile(join(openTopDirectory, "project-context.md")),
    rules: await readOptionalFile(join(openTopDirectory, "rules.md")),
    memory: await readNamedFiles(openTopDirectory, "memory", memoryFiles),
    prompts: await readNamedFiles(openTopDirectory, "prompts", promptFiles),
    pullRequestTemplate: await readOptionalFile(join(openTopDirectory, "templates", "pull-request.md")),
    settings: config.context,
    activeProfiles
  };
}

export async function loadAvailableContextProfiles(): Promise<LoadedContextProfile[]> {
  const [learnedProfiles, userProfiles] = await Promise.all([
    loadProfilesFromRoot(getLearnedProfilesRoot(), "learned-project"),
    loadProfilesFromRoot(getUserProfilesRoot(), "user")
  ]);

  return [...learnedProfiles, ...userProfiles].sort((left, right) => left.displayName.localeCompare(right.displayName));
}

async function loadConfiguredContextProfiles(settings: OpenTopProjectContext["settings"]): Promise<LoadedContextProfile[]> {
  const [learnedProfiles, userProfiles] = await Promise.all([
    Promise.all(settings.learnedProfiles.map((profileId) => loadProfileById(getLearnedProfilesRoot(), profileId, "learned-project"))),
    Promise.all(settings.userProfiles.map((profileId) => loadProfileById(getUserProfilesRoot(), profileId, "user")))
  ]);

  return [...learnedProfiles, ...userProfiles].filter((profile): profile is LoadedContextProfile => Boolean(profile));
}

async function loadProfilesFromRoot(
  rootDirectory: string,
  fallbackType: LoadedContextProfile["type"]
): Promise<LoadedContextProfile[]> {
  try {
    const entries = await readdir(rootDirectory, { withFileTypes: true });
    const loaded = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => loadProfileById(rootDirectory, entry.name, fallbackType))
    );

    return loaded.filter((profile): profile is LoadedContextProfile => Boolean(profile));
  } catch (error) {
    if (isMissingFileError(error)) {
      return [];
    }

    throw error;
  }
}

async function loadProfileById(
  rootDirectory: string,
  profileId: string,
  fallbackType: LoadedContextProfile["type"]
): Promise<LoadedContextProfile | undefined> {
  const profileDirectory = join(rootDirectory, profileId);
  const metadata = await readOptionalYamlFile(join(profileDirectory, "profile.yml"));
  const sections = await readProfileSections(profileDirectory);

  if (Object.keys(sections).length === 0 && !metadata) {
    return undefined;
  }

  const type = readProfileType(metadata, fallbackType);
  return {
    id: readString(metadata, "id") ?? profileId,
    type,
    displayName: readString(metadata, "displayName") ?? profileId,
    description: readString(metadata, "description"),
    sourcePath: profileDirectory,
    promptBudget: {
      maxProfileSections: readNumber(metadata, "promptBudget.maxProfileSections"),
      maxProfileWords: readNumber(metadata, "promptBudget.maxProfileWords")
    },
    sections
  };
}

async function readProfileSections(profileDirectory: string): Promise<Record<string, string>> {
  const entries = await Promise.all(
    profileSectionFiles.map(async (name) => {
      const content = await readOptionalFile(join(profileDirectory, `${name}.md`));
      return content ? ([name, content] as const) : undefined;
    })
  );

  return Object.fromEntries(entries.filter(Boolean).map((entry) => entry as readonly [string, string]));
}

async function readNamedFiles(
  rootDirectory: string,
  directory: string,
  names: readonly string[]
): Promise<Record<string, string>> {
  const entries = await Promise.all(
    names.map(async (name) => {
      const content = await readOptionalFile(join(rootDirectory, directory, `${name}.md`));
      return [name, content] as const;
    })
  );

  return Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => Boolean(entry[1])));
}

async function readOptionalFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }

    throw error;
  }
}

async function readOptionalYamlFile(path: string): Promise<Record<string, unknown> | undefined> {
  const raw = await readOptionalFile(path);

  if (!raw) {
    return undefined;
  }

  const parsed = parse(raw);
  return isObject(parsed) ? parsed : undefined;
}

function readString(raw: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = readNestedValue(raw, key);
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readNumber(raw: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = readNestedValue(raw, key);
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readProfileType(
  raw: Record<string, unknown> | undefined,
  fallbackType: LoadedContextProfile["type"]
): LoadedContextProfile["type"] {
  const value = readString(raw, "type");
  return value === "user" || value === "learned-project" || value === "team" || value === "organization"
    ? value
    : fallbackType;
}

function readNestedValue(raw: Record<string, unknown> | undefined, key: string): unknown {
  if (!raw) {
    return undefined;
  }

  return key.split(".").reduce<unknown>((current, part) => {
    if (!isObject(current)) {
      return undefined;
    }

    return current[part];
  }, raw);
}

function getLearnedProfilesRoot(): string {
  return join(homedir(), ".opentop", "profiles");
}

function getUserProfilesRoot(): string {
  return join(homedir(), ".opentop", "user-profiles");
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "ENOENT"
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
