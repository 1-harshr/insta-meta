// The only provider-aware code. Every stage asks for a model by "provider:model" id from config.json.
import type { EmbeddingModel, LanguageModel } from "ai";
import { ollama } from "ollama-ai-provider-v2";
import { anthropic } from "@ai-sdk/anthropic";

function split(id: string): [string, string] {
  const i = id.indexOf(":");
  if (i < 0) throw new Error(`Model id must be "provider:model", got "${id}"`);
  return [id.slice(0, i), id.slice(i + 1)];
}

export function getModel(id: string): LanguageModel {
  const [provider, name] = split(id);
  switch (provider) {
    case "ollama":
      return ollama(name);
    case "anthropic":
      return anthropic(name);
    default:
      throw new Error(`Unknown model provider "${provider}"`);
  }
}

export function getEmbeddingModel(id: string): EmbeddingModel {
  const [provider, name] = split(id);
  switch (provider) {
    case "ollama":
      return ollama.textEmbeddingModel(name);
    default:
      throw new Error(`Unknown embedding provider "${provider}"`);
  }
}

// Qwen3 "thinking" is slow and not needed for extraction; other providers ignore this.
export const providerOptions = { ollama: { think: false } };
