import path from "node:path";
import { generateText, Output } from "ai";
import { exists, log, readJson, writeJson, type Config } from "../core.js";
import { getModel, providerOptions } from "../models.js";
import { Ocr, ReelMeta, Transcript, Understanding } from "../schemas.js";
import { reelDirs } from "./download.js";
import { understandPrompt, type ReelInput } from "../prompts.js";

export function reelInput(meta: ReelMeta, transcript: { text: string; language: string }, ocrLines: string[]): ReelInput {
  return {
    uploader: meta.uploader,
    postedAt: meta.timestamp ? new Date(meta.timestamp * 1000).toISOString() : "unknown",
    caption: meta.caption,
    ocr: ocrLines,
    transcript: transcript.text,
    transcriptLang: transcript.language,
  };
}

export async function understand(runDir: string, config: Config): Promise<void> {
  const model = getModel(config.models.understand);
  for (const dir of await reelDirs(runDir)) {
    const out = path.join(dir, "understanding.json");
    if (await exists(out)) continue;
    const meta = await readJson(path.join(dir, "meta.json"), ReelMeta);
    const transcript = await readJson(path.join(dir, "transcript.json"), Transcript);
    const { lines } = await readJson(path.join(dir, "ocr.json"), Ocr);
    const started = Date.now();
    const { output } = await generateText({
      model,
      providerOptions,
      temperature: 0,
      output: Output.object({ schema: Understanding }),
      prompt: understandPrompt(config, reelInput(meta, transcript, lines)),
    });
    await writeJson(out, output);
    log("understand", `${meta.shortcode}: news=${output.isNews} city=${output.isAboutCity} ${output.eventType} ` +
      `n=${output.newsworthiness} c=${output.confidence.toFixed(2)} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  }
}
