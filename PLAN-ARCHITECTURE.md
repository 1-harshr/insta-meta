# insta-meta — Architecture Plan

> Status: DRAFT (skeleton). Last updated 2026-10-17.
> Companion doc: `PLAN-TECH-STACK.md`

## 1. One-line pitch

A local-news aggregator for a city, sourced from Instagram Reels. Input: `city` + optional `keywords`.
Output: a single consolidated "daily news" video (plus a text digest) built from the day's news Reels.

## 2. Inputs / outputs

| | |
|---|---|
| **Input** | `{ city: string; keywords?: string[]; window: "today" \| ISODateRange; lang?: "hi" \| "en" \| ... }` |
| **Output** | `RunResult` (see §6): text digest always; script + mp4 when there are stories; publish only after review |
| **Trigger** | CLI / cron runner (orchestrator). No UI in v1. |

## 3. Critical constraint discovered during research (read first)

**The official Meta/Instagram Graph API cannot do this.**

- Hashtag search (`ig_hashtag_search` → `/recent_media`, `/top_media`) **does not return Reels**, Stories or IGTV.
- Recent-media is capped at **250 posts / last 24h**, and each app user may query only **30 unique hashtags per rolling 7 days**.
- There is **no keyword search** and **no location-based search** in the public Graph API at all; location IDs only exist for *tagging your own posts*.
- Graph API only reads media of accounts that have *authorised your app* (Business/Creator accounts), not arbitrary public reels.

→ "Meta integration" in v1 can only mean: (a) Instagram Login/Graph API for **publishing** the final compiled video back to an IG account, and (b) optionally the Content Publishing API. **Ingestion must come from unofficial / third-party sources.**

## 4. Ingestion options (decision needed — see §9)

| Option | How | Pros | Cons |
|---|---|---|---|
| **A. Managed scraping API (Apify / HikerAPI / ScrapeCreators)** | Pay-per-result HTTP API; keyword + hashtag + reel search; some return transcripts | No bans, no proxies, no login; quickest to v1; transcripts included on some actors | Cost per 1k results ($0.90–$5); vendor dependency; freshness depends on vendor |
| **B. Self-hosted private-API client (`instagrapi` / `aiograpi`, Python)** | Logged-in burner account, mimics mobile app; `hashtag_medias_recent`, `fbsearch_places`, `location_medias_recent`, reels/clips endpoints | Full control; cheapest at scale; location-based search possible | Account bans, challenge/2FA loops, needs residential proxies; ToS risk; maintenance burden |
| **C. Headless browser (Playwright) on web Instagram** | Drive `instagram.com/explore/search/keyword/?q=` and `/explore/tags/`, intercept GraphQL JSON | Mirrors exactly what you see when you search "Daltonganj" | Slowest; brittle to UI changes; login still needed for most search |
| **D. Known-source crawling** | Curate a list of local news handles for the city; pull their reels (public, stable) | Highest signal-to-noise; most stable endpoint | Needs per-city bootstrap; misses viral citizen reels |

**Recommended v1:** A (Apify) + D (curated handles). Keep an `IngestSource` interface so B/C can be added later without touching downstream stages.

## 5. Pipeline (stages)

```
[1] Discover ──▶ [2] Pre-filter ──▶ [3] Fetch media ──▶ [4] Understand ──▶ [5] Cluster/Rank ──▶ [6] Script ──▶ [7] Render ──▶ [8] Review ──▶ [9] Publish
                 (metadata only)                        (incl. media dedupe)                                               (human gate)
```

### 5.1 Discover
- Query every configured `IngestSource` with `{city, keywords, since}`.
- Expand city → search terms: city name variants (Latin + Devanagari, e.g. "Daltonganj" / "डाल्टनगंज" / "Medininagar"), district, nearby hashtags (`#daltonganj`, `#palamu`, `#palamunews`).
- Emit `ReelCandidate[]` (normalised, strictly typed).

### 5.2 Pre-filter (metadata only — no media downloaded yet)
- Time window filter (`taken_at >= startOfDay(city tz)`). Scraper search results are *not* reliably sorted or bounded by date → over-fetch and filter locally.
- Dedupe by `shortcode` and by exact caption hash.
- Cheap news-vs-promo/meme classifier on caption + author bio + thumbnail (one small LLM call). Drop obvious non-news so we don't pay to fetch/transcribe it.

### 5.3 Fetch media
- Download mp4 + thumbnail (+ scraper-supplied transcript if any) to storage.
- Keep originals only as long as needed (retention policy in config).

### 5.4 Understand (per reel)
- Media-level dedupe: perceptual hash on keyframes / audio fingerprint (reposts across local pages are very common; this needs the file, so it lives here not in 5.2).
- ASR: Hindi/Hinglish/English code-switching — needs a bake-off before committing (see tech-stack open decisions).
- OCR on keyframes (local news reels are often text-on-screen only). Claude vision on 3–5 keyframes may be enough and removes a vendor.
- LLM extraction with strict schema → `ReelUnderstanding` (see §6). Every claim in `summary` should be traceable to transcript/OCR text — the model must not invent details.

### 5.5 Cluster / Rank
- Group reels about the same event (embedding similarity on summaries).
- Rank stories by: #independent sources, engagement, recency, relevance to `keywords`.
- Output `Story[]` each with `supportingReels[]`.

### 5.6 Script
- LLM writes a news bulletin script: intro, per-story segment (headline, 2–3 sentences, which clip to show), outro.
- Strict JSON schema → `BulletinScript`.

### 5.7 Render
- Compose vertical (9:16) video: clips from source reels (trimmed to the relevant seconds), lower-third captions, TTS voice-over or on-screen text, source attribution overlay.
- Also produce a markdown/HTML text digest.

### 5.8 Review (human gate)
- This is *news*. A wrong summary (wrong name, wrong death toll, wrong accused) is a real harm, and LLM extraction from noisy Hindi ASR will get things wrong.
- v1: pipeline stops here and writes `review.md` (script + per-segment source links + video preview). Human runs `insta-meta approve <run-id>` (optionally after editing the script, which triggers a re-render).
- Later: auto-approve only stories with ≥2 independent sources and high confidence; everything else still waits.
- Empty day (0 stories after ranking): write the digest, skip render + publish, exit 0.

### 5.9 Publish (the actual "Meta integration")
- Optional: post the bulletin to an IG Business account via Graph API Content Publishing (`/media` → `/media_publish`, `media_type=REELS`).
- Also: local file / Telegram / WhatsApp channel as cheaper distribution.

## 6. Core domain types (sketch)

```ts
type IngestSourceId = "apify:reels-keyword" | "apify:reels-lowcost" | "hikerapi" | "handles" | "instagrapi";
type EventType = "accident" | "crime" | "politics" | "civic" | "weather" | "health" | "education"
               | "sports" | "culture" | "other";

type CityQuery = { city: string; aliases: string[]; keywords: string[]; since: Date; until: Date; tz: string };

type ReelCandidate = {
  shortcode: string; url: string; takenAt: Date; caption: string;
  author: { username: string; isVerified: boolean; followers?: number };
  stats: { views?: number; likes?: number; comments?: number };
  source: IngestSourceId; thumbnailUrl: string; videoUrl?: string; scraperTranscript?: string;
};

type Entity = { kind: "person" | "place" | "org"; name: string };

type ReelUnderstanding = {
  shortcode: string; transcript: string; transcriptLang: string; ocrText: string[];
  summary: string; entities: Entity[]; eventType: EventType; locationMention?: string;
  isNews: boolean; isAboutCity: boolean; confidence: number;   // 0–1
  mediaHash: string;                                            // for dedupe
};

type Story = {
  id: string; headline: string; summary: string; eventType: EventType;
  reels: ReelUnderstanding[]; independentSources: number; score: number;
};

type Segment = { storyId: string; headline: string; narration: string;
                 clip: { shortcode: string; startSec: number; endSec: number } | null };  // null → card-only segment
type BulletinScript = { city: string; date: string; lang: string; intro: string; segments: Segment[]; outro: string };

type NewsDigest = { city: string; date: string; stories: Story[]; markdown: string };
type RunResult = { digest: NewsDigest; script?: BulletinScript; videoPath?: string; status: "awaiting-review" | "approved" | "published" | "empty" };
```

## 7. Runtime shape

- Single repo, **pipeline-as-a-DAG** with each stage a pure function `(input, deps) => output`, persisted between stages so any stage can be re-run.
- Run record per `(city, date)` → `runs/<city>/<date>/{candidates,understood,stories,script,review.md,video}`.
- Idempotent; re-runs skip already-understood reels (keyed by shortcode). `ReelUnderstanding` is cached globally, not per run, since the same reel can surface on consecutive days.
- Rough cost per run (Daltonganj, ~200 candidates → ~60 fetched → ~15 stories): scraping ~$0.50, ASR ~$0.50, LLM ~$0.50–1.00, render ~free. **≈ $2/day** — cheap enough that over-fetching is fine.
- Job queue only when multi-city / scheduled; v1 is a single `run --city Daltonganj` CLI.

## 8. Non-functional

- **Cost ceiling per run** (scraping + LLM + ASR) — track and log per stage.
- **Legal/ToS**: scraping public data is a grey area; publishing *others'* clips in a compilation is a copyright/fair-use question. Decide: link-out digest vs. clip reuse vs. "news reel generated from summaries only".
- **Observability**: structured logs per stage, run manifest with source counts and drop reasons.
- **Rate limits / bans**: isolate ingestion behind retries + circuit breaker; never block the rest of the pipeline on one source.

## 9. Open decisions

- [ ] Ingestion: Apify-first (A+D) vs. self-hosted `instagrapi` (B)?
- [ ] **(Blocking for 5.7)** Output: reuse source clips, or generate a fresh "anchor" video from summaries only (avoids copyright)? This decides whether the render stage is "ffmpeg trim + overlay" or "TTS + motion graphics" — very different builds.
- [ ] Language: Hindi, English, or bilingual bulletin?
- [ ] Where does the video get published (IG account via Graph API, YouTube Shorts, Telegram, just a file)?
- [ ] One city (Daltonganj) hard-coded for v1, or multi-city config from day one?

## 10. Prior art found on GitHub (none does the whole thing)

| Repo | What it covers | Takeaway |
|---|---|---|
| [subzeroid/instagrapi](https://github.com/subzeroid/instagrapi) / [aiograpi](https://github.com/subzeroid/aiograpi) | Python private-API client, actively maintained (pushed Oct 2026), hashtag/location/reels endpoints; HikerAPI SaaS backend | Best self-hosted ingestion option (Python) |
| [instaloader/instaloader](https://github.com/instaloader/instaloader) | Python downloader by profile/hashtag/location | Stable for Option D (known handles) |
| [dilame/instagram-private-api](https://github.com/dilame/instagram-private-api) | TypeScript private-API SDK | **Unmaintained since Aug 2024** — don't build on it |
| [ahmedrangel/instagram-media-scraper](https://github.com/ahmedrangel/instagram-media-scraper) | Node, public reel URL → media, no login | Useful for Stage 5.3 fetch |
| [Avnsh1111/Instagram-Reels-Scraper-Auto-Poster](https://github.com/Avnsh1111/Instagram-Reels-Scraper-Auto-Poster) | Scrape reels from accounts → repost | Closest to Option D + Publish, but no summarisation |
| [nileshyadav12/ai-news-shorts-generator](https://github.com/nileshyadav12/ai-news-shorts-generator) | Scrape news sites → Gemini summary → TTS → vertical video | Stage 5.6–5.7 pattern, but text-news sourced |
| [remotion-dev/remotion](https://github.com/remotion-dev/remotion) | Programmatic video in React/TS | Primary render candidate |
| Apify actors: [instagram-reels-scraper (hashtag & keyword)](https://apify.com/api-empire/instagram-reels-scraper), [instagram-reels-scraper-lowcost](https://apify.com/sones/instagram-reels-scraper-lowcost), [instagram-scraper (keyword search since Sep 2026)](https://apify.com/omaraw/instagram-scraper) | Managed scraping, $0.90–$4.99 per 1k reels, some with transcripts | Fastest path to v1 ingestion |

**Conclusion:** no existing project does "city → news reels → compiled bulletin". The pieces exist; the novelty is the pipeline + the news-understanding/clustering layer.
