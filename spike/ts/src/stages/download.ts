import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { exists, log, run, writeJson } from "../core.js";
import type { ReelMeta } from "../schemas.js";

const FRAME_COUNT = 5;

// Subset of yt-dlp's info.json we rely on.
const YtInfo = z.object({
  description: z.string().nullish(),
  title: z.string().nullish(),
  uploader: z.string().nullish(),
  channel: z.string().nullish(),
  uploader_id: z.string().nullish(),
  timestamp: z.number().nullish(),
  duration: z.number().nullish(),
  view_count: z.number().nullish(),
  like_count: z.number().nullish(),
});

export function shortcodeOf(url: string): string {
  const m = url.match(/instagram\.com\/(?:[^/]+\/)?(?:reels?|p|tv)\/([A-Za-z0-9_-]+)/);
  if (!m?.[1]) throw new Error(`Not an Instagram reel/post URL: ${url}`);
  return m[1];
}

export async function readLinks(file: string): Promise<string[]> {
  const text = await readFile(file, "utf8");
  return [...new Set(text.match(/https?:\/\/(?:www\.)?instagram\.com\/[^\s"'<>]+/g) ?? [])];
}

function ytDlpAuthArgs(): string[] {
  const browser = process.env.YTDLP_COOKIES_BROWSER; // e.g. "chrome" if Instagram demands login
  return browser ? ["--cookies-from-browser", browser] : [];
}

async function downloadOne(url: string, dir: string): Promise<ReelMeta> {
  const shortcode = shortcodeOf(url);
  const video = path.join(dir, "video.mp4");
  if (!(await exists(video))) {
    await run("yt-dlp", [
      ...ytDlpAuthArgs(),
      "--no-playlist", "--write-info-json", "--no-progress",
      "-f", "best[ext=mp4]/best", "--remux-video", "mp4",
      "-o", path.join(dir, "video.%(ext)s"),
      url,
    ]);
  }
  const info = YtInfo.parse(JSON.parse(await readFile(path.join(dir, "video.info.json"), "utf8")));

  if (!(await exists(path.join(dir, "audio.wav")))) {
    await run("ffmpeg", ["-y", "-loglevel", "error", "-i", video, "-vn", "-ac", "1", "-ar", "16000", path.join(dir, "audio.wav")])
      .catch(() => log("download", `${shortcode}: no audio track`));
  }

  const duration = info.duration ?? 10;
  const frames: string[] = [];
  for (let i = 0; i < FRAME_COUNT; i++) {
    const name = `frame_${i}.jpg`;
    const t = ((i + 0.5) * duration) / FRAME_COUNT;
    if (!(await exists(path.join(dir, name)))) {
      await run("ffmpeg", ["-y", "-loglevel", "error", "-ss", t.toFixed(2), "-i", video,
        "-frames:v", "1", "-vf", "scale=720:-2", path.join(dir, name)]);
    }
    frames.push(name);
  }

  return {
    shortcode,
    url,
    caption: info.description ?? info.title ?? "",
    uploader: info.uploader_id ?? info.channel ?? info.uploader ?? "unknown",
    timestamp: info.timestamp ?? null,
    durationSec: info.duration ?? null,
    views: info.view_count ?? null,
    likes: info.like_count ?? null,
    frames,
  };
}

export async function download(runDir: string, links: string[]): Promise<void> {
  let ok = 0;
  for (const url of links) {
    let shortcode: string;
    try {
      shortcode = shortcodeOf(url);
    } catch (e) {
      log("download", `skip: ${(e as Error).message}`);
      continue;
    }
    const dir = path.join(runDir, "reels", shortcode);
    if (await exists(path.join(dir, "meta.json"))) { ok++; continue; }
    try {
      const meta = await downloadOne(url, dir);
      await writeJson(path.join(dir, "meta.json"), meta);
      ok++;
      log("download", `${shortcode} ok (${meta.durationSec ?? "?"}s, @${meta.uploader})`);
    } catch (e) {
      log("download", `${shortcode} FAILED: ${(e as Error).message.split("\n").slice(-3).join(" ")}`);
    }
  }
  log("download", `${ok}/${links.length} reels ready`);
}

export async function reelDirs(runDir: string): Promise<string[]> {
  const root = path.join(runDir, "reels");
  if (!(await exists(root))) return [];
  const names = await readdir(root);
  const dirs: string[] = [];
  for (const n of names) if (await exists(path.join(root, n, "meta.json"))) dirs.push(path.join(root, n));
  return dirs.sort();
}
