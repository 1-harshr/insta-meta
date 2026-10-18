import { writeFile } from "node:fs/promises";
import path from "node:path";
import { generateText, Output } from "ai";
import { log, writeJson, type Config } from "../core.js";
import { getModel, providerOptions } from "../models.js";
import { Bulletin, type Story } from "../schemas.js";

export async function script(runDir: string, config: Config, stories: Story[], date: string): Promise<void> {
  const top = stories.slice(0, config.maxStories);
  const storiesText = top
    .map((s) => `[${s.id}] ${s.headline}\n${s.summary}\nSource reels: ${s.reels.join(", ")}`)
    .join("\n\n");

  const { output } = await generateText({
    model: getModel(config.models.script),
    providerOptions,
    temperature: 0.4,
    output: Output.object({ schema: Bulletin }),
    prompt: `You write a short daily news bulletin for an Instagram reel about ${config.city}, read by an AI news anchor.

Language: ${config.language} — conversational Hindi-English mix written in Roman script, like a friendly local news page. Simple words.
Style: neutral, factual, no opinions, no sensationalism. Never add facts not in the stories. If a story says sources disagree, say "reports ke mutabik" and keep it vague.
Length: intro 1 sentence, each segment 2-3 sentences, outro 1 sentence. One segment per story, in the order given.
Intro: greet viewers and name the city and date. Outro: a simple sign-off asking viewers to follow for daily ${config.city} updates.
Keep proper nouns (places, hospitals, people) exactly as given in the stories.
For each segment pick one of its source reels as clipShortcode.

Date: ${date}

STORIES:
${storiesText}`,
  });

  const valid = output.segments.filter((seg) => top.some((s) => s.id === seg.storyId));
  const bulletin = { ...output, segments: valid };
  await writeJson(path.join(runDir, "script.json"), bulletin);
  await writeFile(path.join(runDir, "review.md"), reviewMarkdown(config, date, bulletin, stories));
  log("script", `${valid.length} segments → review.md`);
}

function reviewMarkdown(config: Config, date: string, b: Bulletin, stories: Story[]): string {
  const byId = new Map(stories.map((s) => [s.id, s]));
  const segs = b.segments.map((seg, i) => {
    const s = byId.get(seg.storyId);
    const links = (s?.reels ?? []).map((c) => `[${c}](https://www.instagram.com/reel/${c}/)`).join(", ");
    return `### ${i + 1}. ${seg.headline}\n\n> ${seg.narration}\n\n` +
      `- **Fact base:** ${s?.summary ?? "?"}\n- **Sources (${s?.independentSources ?? 0} pages):** ${links}\n- **B-roll:** ${seg.clipShortcode}`;
  });
  const dropped = stories.slice(config.maxStories).map((s) => `- ${s.headline} (score ${s.score.toFixed(1)})`);
  return `# ${config.city} bulletin — ${date} (REVIEW BEFORE PUBLISHING)\n\n**Intro:** ${b.intro}\n\n${segs.join("\n\n")}\n\n` +
    `**Outro:** ${b.outro}\n` + (dropped.length ? `\n## Not included\n\n${dropped.join("\n")}\n` : "");
}
