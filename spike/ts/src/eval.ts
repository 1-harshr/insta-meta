// Prompt-tuning harness: local model vs. ground truth written by a reviewer who watched the reel.
//
//   npx tsx src/eval.ts add <runDir>/reels/<shortcode>   copy a real reel's inputs into eval/cases + contact sheet to watch
//   npx tsx src/eval.ts run [--runs 3] [--case <id>]     run the understand prompt on every case with a ground truth, score it
//
// Case layout: eval/cases/<id>/{input.json, expected.json, sheet.jpg}
import { copyFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { generateText, Output } from "ai";
import { z } from "zod";
import { exists, loadConfig, readJson, run, SPIKE_DIR, writeJson } from "./core.js";
import { getModel, providerOptions } from "./models.js";
import { understandPrompt, type ReelInput } from "./prompts.js";
import { EventType, Ocr, ReelMeta, Transcript, Understanding } from "./schemas.js";
import { reelInput } from "./stages/understand.js";

const CASES = path.join(SPIKE_DIR, "eval", "cases");
const RESULTS = path.join(SPIKE_DIR, "eval", "results");

const ReelInputSchema = z.object({
  uploader: z.string(), postedAt: z.string(), caption: z.string(),
  ocr: z.array(z.string()), transcript: z.string(), transcriptLang: z.string(),
}) satisfies z.ZodType<ReelInput>;

// Ground truth. Text checks are case-insensitive substring matches against summary + place + people.
const Expected = z.object({
  whatHappened: z.string().describe("Reviewer's own one-line account after watching the reel"),
  isNews: z.boolean(),
  isAboutCity: z.boolean(),
  eventType: z.array(EventType).optional().describe("Any of these is acceptable"),
  place: z.array(z.string()).optional().describe("place must contain one of these"),
  people: z.array(z.string()).optional().describe("Exact set of named people expected (substring match)"),
  mustMention: z.array(z.array(z.string())).default([]).describe("Each group: at least one alternative must appear"),
  mustNotMention: z.array(z.string()).default([]).describe("Hallucination / mistranslation traps"),
});
type Expected = z.infer<typeof Expected>;

type Check = { name: string; pass: boolean; detail: string };

const has = (hay: string, needle: string) => hay.toLowerCase().includes(needle.toLowerCase());

function score(u: Understanding, e: Expected): Check[] {
  const text = [u.summary, u.place ?? "", ...u.people].join(" | ");
  const checks: Check[] = [
    { name: "isNews", pass: u.isNews === e.isNews, detail: `got ${u.isNews}` },
    { name: "isAboutCity", pass: u.isAboutCity === e.isAboutCity, detail: `got ${u.isAboutCity}` },
  ];
  if (!e.isNews) return checks; // facts don't matter for non-news
  if (e.eventType) checks.push({ name: "eventType", pass: e.eventType.includes(u.eventType), detail: `got ${u.eventType}` });
  if (e.place) checks.push({ name: "place", pass: e.place.some((p) => has(u.place ?? "", p)), detail: `got ${u.place}` });
  if (e.people) {
    const missing = e.people.filter((p) => !u.people.some((q) => has(q, p)));
    const extra = u.people.filter((q) => !e.people!.some((p) => has(q, p)));
    checks.push({ name: "people", pass: !missing.length && !extra.length, detail: `missing [${missing}] extra [${extra}]` });
  }
  for (const group of e.mustMention) {
    checks.push({ name: `mentions ${group.join("/")}`, pass: group.some((g) => has(text, g)), detail: "" });
  }
  for (const trap of e.mustNotMention) {
    checks.push({ name: `avoids "${trap}"`, pass: !has(text, trap), detail: "" });
  }
  return checks;
}

async function add(reelDir: string): Promise<void> {
  const meta = await readJson(path.join(reelDir, "meta.json"), ReelMeta);
  const transcript = await readJson(path.join(reelDir, "transcript.json"), Transcript);
  const { lines } = await readJson(path.join(reelDir, "ocr.json"), Ocr);
  const dir = path.join(CASES, meta.shortcode);
  await writeJson(path.join(dir, "input.json"), reelInput(meta, transcript, lines));
  await copyFile(path.join(reelDir, "video.mp4"), path.join(dir, "video.mp4"));
  // One frame every 2s, tiled, so a reviewer can "watch" the reel at a glance.
  await run("ffmpeg", ["-y", "-loglevel", "error", "-i", path.join(dir, "video.mp4"),
    "-vf", "fps=1/2,scale=240:-2,tile=6x3", "-frames:v", "1", path.join(dir, "sheet.jpg")]);
  console.log(`added ${dir} — watch it, then write expected.json`);
}

async function runEval(runs: number, only?: string): Promise<void> {
  const config = await loadConfig();
  const modelId = config.models.understand;
  const model = getModel(modelId);
  const ids = (await readdir(CASES)).filter((id) => !only || id === only).sort();
  const lines: string[] = [];
  let passed = 0, total = 0;

  for (const id of ids) {
    const dir = path.join(CASES, id);
    if (!(await exists(path.join(dir, "expected.json")))) { console.log(`- ${id}: no expected.json, skipped`); continue; }
    const input = await readJson(path.join(dir, "input.json"), ReelInputSchema);
    const expected = await readJson(path.join(dir, "expected.json"), Expected);
    const outputs: Understanding[] = [];
    for (let i = 0; i < runs; i++) {
      const { output } = await generateText({
        model, providerOptions, temperature: 0,
        output: Output.object({ schema: Understanding }),
        prompt: understandPrompt(config, input),
      });
      outputs.push(output);
    }
    // A check passes only if it passes on every run (stability is part of correctness).
    const perRun = outputs.map((o) => score(o, expected));
    const names = perRun[0]!.map((c) => c.name);
    const failures = names.flatMap((name, i) => {
      const results = perRun.map((r) => r[i]!);
      const fails = results.filter((r) => !r.pass).length;
      return fails ? [`${name} (${fails}/${runs} runs failed${results.find((r) => !r.pass)?.detail ? `: ${results.find((r) => !r.pass)!.detail}` : ""})`] : [];
    });
    passed += names.length - failures.length;
    total += names.length;
    const status = failures.length ? "FAIL" : "PASS";
    console.log(`${status} ${id}  ${names.length - failures.length}/${names.length}${failures.length ? "\n     " + failures.join("\n     ") : ""}`);
    lines.push(`## ${status} ${id}\n\n**Truth:** ${expected.whatHappened}\n\n` +
      (failures.length ? failures.map((f) => `- ❌ ${f}`).join("\n") + "\n\n" : "") +
      outputs.map((o, i) => `- run ${i + 1}: ${o.summary} _(place: ${o.place}; people: ${o.people.join(", ") || "none"}; ${o.eventType}, n=${o.newsworthiness})_`).join("\n"));
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const report = `# Eval ${stamp}\n\nModel: \`${modelId}\` · runs per case: ${runs} · **${passed}/${total} checks passed**\n\n${lines.join("\n\n")}\n`;
  const file = path.join(RESULTS, `${stamp}.md`);
  await writeJson(path.join(RESULTS, ".keep"), {});
  await writeFile(file, report);
  console.log(`\n${passed}/${total} checks passed → ${file}`);
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { runs: { type: "string", default: "3" }, case: { type: "string" } },
});
const [cmd, arg] = positionals;
if (cmd === "add" && arg) await add(path.resolve(arg));
else if (cmd === "run") await runEval(Number(values.runs), values.case);
else console.log("usage: eval.ts add <reelDir> | eval.ts run [--runs N] [--case id]");
