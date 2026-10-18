import { readFile } from "node:fs/promises";
import path from "node:path";
import { generateText, Output } from "ai";
import { exists, log, readJson, writeJson, type Config } from "../core.js";
import { getModel, providerOptions } from "../models.js";
import { Ocr, ReelMeta } from "../schemas.js";
import { reelDirs } from "./download.js";

const PROMPT = `These are keyframes from one short Instagram news video.
Transcribe ALL text visible on screen (headlines, tickers, captions, banners, signboards), verbatim, in its original script (Hindi stays in Devanagari).
Merge duplicates across frames. Ignore watermarks/handles unless they are the only text. If there is no text, return an empty list.`;

export async function ocr(runDir: string, config: Config): Promise<void> {
  const model = getModel(config.models.ocr);
  for (const dir of await reelDirs(runDir)) {
    const out = path.join(dir, "ocr.json");
    if (await exists(out)) continue;
    const meta = await readJson(path.join(dir, "meta.json"), ReelMeta);
    const images = await Promise.all(meta.frames.map((f) => readFile(path.join(dir, f))));
    const started = Date.now();
    const { output } = await generateText({
      model,
      providerOptions,
      temperature: 0,
      output: Output.object({ schema: Ocr }),
      messages: [{
        role: "user",
        content: [
          { type: "text", text: PROMPT },
          // Data URLs, not Buffers: ollama-ai-provider-v2@4.0.1 crashes on raw bytes with ai@7.
          ...images.map((data) => ({
            type: "file" as const,
            data: `data:image/jpeg;base64,${data.toString("base64")}`,
            mediaType: "image/jpeg",
          })),
        ],
      }],
    });
    await writeJson(out, output);
    log("ocr", `${meta.shortcode}: ${output.lines.length} lines (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  }
}
