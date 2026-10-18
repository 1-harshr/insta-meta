import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { z } from "zod";

export const SPIKE_DIR = path.resolve(import.meta.dirname, "../..");

export const Config = z.object({
  city: z.string(),
  aliases: z.array(z.string()),
  language: z.string(),
  models: z.object({
    understand: z.string(),
    ocr: z.string(),
    script: z.string(),
    embed: z.string(),
  }),
  whisperModel: z.string(),
  clusterThreshold: z.number(),
  maxStories: z.number().int(),
});
export type Config = z.infer<typeof Config>;

export async function loadConfig(): Promise<Config> {
  return Config.parse(JSON.parse(await readFile(path.join(SPIKE_DIR, "config.json"), "utf8")));
}

export async function exists(p: string): Promise<boolean> {
  return access(p).then(() => true, () => false);
}

export async function readJson<S extends z.ZodType>(p: string, schema: S): Promise<z.infer<S>> {
  return schema.parse(JSON.parse(await readFile(p, "utf8")));
}

export async function writeJson(p: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(data, null, 2) + "\n");
}

export function run(cmd: string, args: string[], opts: { cwd?: string } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd });
    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}: ${err.slice(-2000)}`)),
    );
  });
}

export function log(stage: string, msg: string): void {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${stage.padEnd(10)} ${msg}`);
}
