import path from "node:path";
import { cosineSimilarity, embedMany, generateText, Output } from "ai";
import { log, readJson, writeJson, type Config } from "../core.js";
import { getEmbeddingModel, getModel, providerOptions } from "../models.js";
import { Hashes, ReelMeta, StoryText, Understanding, type Story } from "../schemas.js";
import { reelDirs } from "./download.js";

type Reel = { meta: ReelMeta; u: Understanding; hashes: string[] };

const DUP_HAMMING = 8; // phash bits (of 64) within which two frames count as the same shot

function hamming(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) { n += Number(x & 1n); x >>= 1n; }
  return n;
}

// Reposts: at least 2 frames of one reel match frames of the other.
function isDuplicate(a: Reel, b: Reel): boolean {
  let matches = 0;
  for (const ha of a.hashes) if (b.hashes.some((hb) => hamming(ha, hb) <= DUP_HAMMING)) matches++;
  return matches >= 2;
}

function engagement(m: ReelMeta): number {
  return Math.log10(1 + (m.views ?? 0) + 10 * (m.likes ?? 0));
}

export async function cluster(runDir: string, config: Config): Promise<Story[]> {
  const reels: Reel[] = [];
  for (const dir of await reelDirs(runDir)) {
    reels.push({
      meta: await readJson(path.join(dir, "meta.json"), ReelMeta),
      u: await readJson(path.join(dir, "understanding.json"), Understanding),
      hashes: (await readJson(path.join(dir, "hashes.json"), Hashes)).frames,
    });
  }

  const relevant = reels.filter((r) => r.u.isNews && r.u.isAboutCity);
  log("cluster", `${relevant.length}/${reels.length} reels are local news`);

  // Drop reposts, keeping the earliest upload.
  relevant.sort((a, b) => (a.meta.timestamp ?? Infinity) - (b.meta.timestamp ?? Infinity));
  const unique: Reel[] = [];
  const dupes: Record<string, string> = {};
  for (const r of relevant) {
    const orig = unique.find((u) => isDuplicate(u, r));
    if (orig) dupes[r.meta.shortcode] = orig.meta.shortcode;
    else unique.push(r);
  }
  log("cluster", `${Object.keys(dupes).length} reposts removed`);
  if (unique.length === 0) return [];

  // Greedy clustering on summary embeddings.
  const { embeddings } = await embedMany({
    model: getEmbeddingModel(config.models.embed),
    values: unique.map((r) => `${r.u.eventType}. ${r.u.place ?? ""}. ${r.u.summary}`),
  });
  const groups: { centroid: number[]; members: Reel[] }[] = [];
  unique.forEach((r, i) => {
    const e = embeddings[i]!;
    const best = groups
      .map((g) => ({ g, sim: cosineSimilarity(g.centroid, e) }))
      .sort((a, b) => b.sim - a.sim)[0];
    if (best && best.sim >= config.clusterThreshold) best.g.members.push(r);
    else groups.push({ centroid: e, members: [r] });
  });

  const model = getModel(config.models.understand);
  const stories: Story[] = [];
  for (const [i, g] of groups.entries()) {
    const reelsText = g.members
      .map((m) => `- @${m.meta.uploader} (${m.u.place ?? "place unknown"}): ${m.u.summary}`)
      .join("\n");
    const { output } = await generateText({
      model,
      providerOptions,
      temperature: 0,
      output: Output.object({ schema: StoryText }),
      prompt: `These reports from different Instagram pages are about the same local event in ${config.city}.
Write one headline and a combined factual summary. Use only facts from the reports; if they disagree, say so.
Do not comment on the number of reports or on the absence of disagreements. Keep proper nouns exactly as given.

${reelsText}`,
    });
    const sources = new Set(g.members.map((m) => m.meta.uploader)).size;
    const newsworthiness = Math.max(...g.members.map((m) => m.u.newsworthiness));
    const reach = Math.max(...g.members.map((m) => engagement(m.meta)));
    stories.push({
      id: `s${i + 1}`,
      ...output,
      eventType: g.members[0]!.u.eventType,
      reels: g.members.map((m) => m.meta.shortcode),
      independentSources: sources,
      score: newsworthiness * 2 + sources * 1.5 + reach,
    });
  }
  stories.sort((a, b) => b.score - a.score);
  await writeJson(path.join(runDir, "stories.json"), { stories, dupes });
  log("cluster", `${stories.length} stories`);
  return stories;
}
