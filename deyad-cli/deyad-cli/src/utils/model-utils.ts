import type { AppConfig } from "./config";

import chalk from "chalk";

const MODEL_LIST_TIMEOUT_MS = 2_000; // 2 seconds
export const RECOMMENDED_MODELS: Array<string> = ["llama2"];

/**
 * Background model loader / cache.
 *
 * We start fetching the list of available models from Ollama once the CLI
 * enters interactive mode. The request is made exactly once during the process
 * and the results are cached for subsequent calls.
 */

let modelsPromise: Promise<Array<string>> | null = null;

async function fetchModels(config: AppConfig): Promise<Array<string>> {
  if (config.provider !== "ollama") {
    return [];
  }
  try {
    const base = config.baseURL?.replace(/\/v1\/?$/, "") ?? "http://localhost:11434";
    const tagsUrl = `${base}/api/tags`;
    const res = await fetch(tagsUrl);
    if (!res.ok) {
      return [];
    }
    const data = (await res.json()) as { models?: Array<{ name?: string }> };
    return (data.models ?? [])
      .map((model) => model.name)
      .filter((name): name is string => typeof name === "string")
      .sort();
  } catch {
    return [];
  }
}

export function preloadModels(config: AppConfig): void {
  if (!modelsPromise) {
    // Fire‑and‑forget – callers that truly need the list should `await`
    // `getAvailableModels()` instead.
    void getAvailableModels(config);
  }
}

export async function getAvailableModels(
  config: AppConfig,
): Promise<Array<string>> {
  if (!modelsPromise) {
    modelsPromise = fetchModels(config);
  }
  return modelsPromise;
}

/**
 * Verify that the provided model identifier is present in the set returned by
 * {@link getAvailableModels}. The list of models is fetched from Ollama once
 * per process and then cached in‑process.
 */
export async function isModelSupported(
  model: string | undefined | null,
  config: AppConfig,
): Promise<boolean> {
  if (
    typeof model !== "string" ||
    model.trim() === "" ||
    RECOMMENDED_MODELS.includes(model)
  ) {
    return true;
  }

  try {
    const models = await Promise.race<Array<string>>([
      getAvailableModels(config),
      new Promise<Array<string>>((resolve) =>
        setTimeout(() => resolve([]), MODEL_LIST_TIMEOUT_MS),
      ),
    ]);

    // If the timeout fired we get an empty list → treat as supported to avoid
    // false negatives.
    if (models.length === 0) {
      return true;
    }

    return models.includes(model.trim());
  } catch {
    // Network or library failure → don't block start‑up.
    return true;
  }
}

export function reportMissingAPIKeyForProvider(provider: string): void {
  // eslint-disable-next-line no-console
  console.error(
    (provider
      ? `\n${chalk.red("Unsupported provider:")} ${provider}\n\n`
      : `\n${chalk.red("Missing provider:")}\n\n`) +
      `Only the ${chalk.bold("ollama")} provider is supported by this CLI.\n` +
      `If your Ollama server is not available at the default URL, set ${chalk.bold(
        "OLLAMA_BASE_URL",
      )}.\n` +
      `Then re-run this command.\n`,
  );
}

