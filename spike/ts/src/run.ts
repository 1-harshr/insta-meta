// Usage: npx tsx src/run.ts <links.txt> [runId]
// Every stage caches its output per reel, so re-running resumes where it stopped.
import path from "node:path";
import { loadConfig, log, run, SPIKE_DIR } from "./core.js";
import { download, readLinks } from "./stages/download.js";
import { ocr } from "./stages/ocr.js";
import { understand } from "./stages/understand.js";
import { cluster } from "./stages/cluster.js";
import { script } from "./stages/script.js";

const [linksFile, runIdArg] = process.argv.slice(2);
if (!linksFile) {
  console.error("Usage: npx tsx src/run.ts <links.txt> [runId]");
  process.exit(1);
}

const date = new Date().toISOString().slice(0, 10);
const runDir = path.join(SPIKE_DIR, "runs", runIdArg ?? date);
const config = await loadConfig();
const t0 = Date.now();
const timed = async <T>(name: string, f: () => Promise<T>): Promise<T> => {
  const s = Date.now();
  const r = await f();
  log(name, `done in ${((Date.now() - s) / 1000).toFixed(0)}s`);
  return r;
};

log("run", `${runDir}  models: ${JSON.stringify(config.models)}`);
await timed("download", async () => download(runDir, await readLinks(path.resolve(linksFile))));
await timed("media", () =>
  run("uv", ["run", "media.py", runDir, config.whisperModel], { cwd: path.join(SPIKE_DIR, "py") }).then((o) =>
    o.trim() && console.log(o.trim()),
  ),
);
await timed("ocr", () => ocr(runDir, config));
await timed("understand", () => understand(runDir, config));
const stories = await timed("cluster", () => cluster(runDir, config));
if (stories.length === 0) log("script", "no local news stories found — nothing to script");
else await timed("script", () => script(runDir, config, stories, date));
log("run", `finished in ${((Date.now() - t0) / 1000).toFixed(0)}s → ${path.join(runDir, "review.md")}`);
