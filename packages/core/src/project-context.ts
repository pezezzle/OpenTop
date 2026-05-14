import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { findOpenTopDirectory } from "./config.js";
import type { OpenTopProjectContext } from "./types.js";

const memoryFiles = ["decisions", "conventions", "risks", "glossary", "known-issues"] as const;
const promptFiles = ["bugfix", "feature", "planner", "reviewer"] as const;

export async function loadOpenTopProjectContext(startDirectory = process.cwd()): Promise<OpenTopProjectContext> {
  const openTopDirectory = await findOpenTopDirectory(startDirectory);

  return {
    rootDirectory: dirname(openTopDirectory),
    projectContext: await readOptionalFile(join(openTopDirectory, "project-context.md")),
    rules: await readOptionalFile(join(openTopDirectory, "rules.md")),
    memory: await readNamedFiles(openTopDirectory, "memory", memoryFiles),
    prompts: await readNamedFiles(openTopDirectory, "prompts", promptFiles),
    pullRequestTemplate: await readOptionalFile(join(openTopDirectory, "templates", "pull-request.md"))
  };
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

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "ENOENT"
  );
}
