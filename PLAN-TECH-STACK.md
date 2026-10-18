# insta-meta — Tech Stack Plan

> Status: DRAFT (skeleton). Last updated 2026-10-17.
> Companion doc: `PLAN-ARCHITECTURE.md`
> Constraint from owner: **strictly typed** — TypeScript or Python with full type hints.

## 1. Language decision

| | TypeScript | Python (typed) |
|---|---|---|
| Instagram ingestion libs | `instagram-private-api` is **dead** (2024). Only managed APIs (Apify/HikerAPI HTTP) are viable from TS. | `instagrapi` / `aiograpi` actively maintained; `instaloader` stable. |
| ASR / OCR / ML | Call out to APIs (OpenAI/Deepgram) or shell to whisper.cpp | `faster-whisper`, `whisperx`, PaddleOCR/EasyOCR run natively |
| Video render | **Remotion** (React, best-in-class for templated vertical video); `fluent-ffmpeg` | `moviepy` (fine but slow/ugly), raw `ffmpeg` |
| Strictness | `strict: true`, Zod at every I/O boundary — excellent | `mypy --strict` / pyright strict + Pydantic v2 — good |
| LLM structured output | Anthropic SDK + Zod schemas | Anthropic SDK + Pydantic |

**Recommendation:** **TypeScript monorepo as the backbone** (orchestrator, pipeline, LLM, render, publish), with ingestion behind an interface so that:
- v1 ingestion = Apify/HikerAPI HTTP calls (pure TS), and
- a **Python sidecar** (`instagrapi` + `faster-whisper`) can be plugged in later via a small typed HTTP/CLI contract if self-hosting becomes necessary.

Alternative if you'd rather avoid two runtimes: all-Python with Pydantic + `mypy --strict`, rendering via `ffmpeg` filtergraphs instead of Remotion. Less pretty output, one language.

> **Decision:** ☐ TS-first (+ optional Python sidecar)   ☐ All-Python   ☐ All-TS (managed APIs only)

## 2. Proposed stack (TS-first)

### Runtime & tooling
- Node 22 LTS (or Bun 1.x — decide), **pnpm** workspaces, **TypeScript 5.x `strict`**
- **Zod** for all external data (scraper responses, LLM output, config)
- **tsx** for dev, **tsup** for builds, **vitest** for tests, **biome** for lint/format
- Env/config: `zod`-validated `config.ts` loaded from `.env` + `cities/<city>.yaml`

### Repo layout (sketch)
Start as **one package** with folders — a pnpm monorepo is overhead for one person and one CLI. Split into packages only if the Remotion app or Python sidecar actually needs its own build.
```
insta-meta/
  src/
    core/        # domain types (Zod), pipeline runner, run store
    ingest/      # IngestSource interface + adapters: apify, hikerapi, handles, (later) instagrapi-sidecar
    understand/  # ASR, OCR, LLM extraction, embeddings, media dedupe
    cluster/     # story clustering + ranking
    script/      # bulletin script generation
    render/      # Remotion composition + ffmpeg trimming
    review/      # review.md writer, approve command
    publish/     # IG Graph API publishing, telegram, filesystem
    cli.ts       # `insta-meta run --city Daltonganj --date today` / `insta-meta approve <run>`
  remotion/      # Remotion project (compositions); rendered from src/render
  cities/        # <city>.yaml: aliases, hashtags, curated handles
  sidecar-py/    # (optional, later) instagrapi + faster-whisper FastAPI
```

### Ingestion
- **Apify client** (`apify-client`) — actors: reels-by-keyword/hashtag, lowcost reels scraper (has transcripts)
- **HikerAPI** (HTTP, backs `instagrapi`) — alternative managed source
- Curated handles list per city (`cities/daltonganj.yaml`)
- Later: Python sidecar with `aiograpi` for location/place search

### Media fetch & storage
- `undici` fetch → local disk for v1; S3-compatible (R2/MinIO) when scheduled
- Metadata: **SQLite via Drizzle ORM** (typed schema, zero ops) — upgrade to Postgres if multi-city/cron

### Understanding
- **ASR:** hosted API for v1 (candidates: OpenAI transcription, Deepgram, Sarvam — Sarvam is India-focused and likely best on Hinglish); `faster-whisper` in sidecar later. **Needs a 5-reel bake-off before choosing.**
- **OCR:** keyframes via ffmpeg → **Claude vision first** (already a dependency, handles Devanagari, can also read the frame in context); fall back to Google Vision only if accuracy is poor
- **Media dedupe:** `sharp` + a perceptual hash (e.g. `blockhash`) on keyframes; audio fingerprint later if needed
- **LLM (swappable per stage):** Vercel AI SDK (`ai`) `generateObject()` + Zod schema, so every model returns the same typed object. Model chosen per stage in config as `provider:model` (e.g. `anthropic:claude-sonnet-5-5`, `ollama:qwen3:14b`); one `getModel(id)` factory in `src/core/models.ts` is the only provider-aware code. Default: Claude for understand/script, local models allowed for OCR/vision. `insta-meta eval --model <id>` runs a ~20-reel hand-labelled set in `samples/eval/` to compare models before switching.
- **Embeddings:** Voyage / OpenAI text-embedding-3-small for story clustering

### Clustering / ranking
- Cosine similarity + simple agglomerative threshold (no vector DB needed at this scale); `ml-distance` or hand-rolled

### Rendering
- **Remotion** — `Bulletin` composition: intro card, per-story segment (clip + lower-third + headline), outro, source credits. **License note:** free for individuals / companies ≤3 people; a company license is required beyond that. Renders via headless Chrome — fine on a Mac, needs a Linux box with Chrome deps if moved to cron.
- **ffmpeg** (via `@remotion/media` or `fluent-ffmpeg`) for trimming source clips to the referenced seconds
- **TTS** (optional voice-over): ElevenLabs / Google Cloud TTS (Hindi voices)

### Publishing
- Meta **Instagram Graph API** (Content Publishing, `media_type=REELS`) — requires IG Business/Creator account + Facebook Page + app review for `instagram_content_publish`
- Telegram Bot API / local file as fallback

### Orchestration
- v1: plain CLI, sequential stages, run manifest on disk
- v2: **BullMQ** (Redis) or **Temporal** if runs need retries/scheduling across cities; cron via GitHub Actions or a tiny VPS

## 3. External services & keys needed

| Service | Purpose | Cost note |
|---|---|---|
| Apify (or HikerAPI) | Reel discovery | ~$1–5 / 1k reels |
| Anthropic API | Extraction, clustering help, script | per-token |
| ASR provider | Transcripts (if scraper doesn't supply) | per-minute |
| OCR provider | On-screen text (only if Claude vision isn't enough) | per-image |
| TTS provider | Voice-over (optional) | per-char |
| Meta Developer app | Publishing only | free, needs app review |
| Object storage (later) | Media | ~free at this scale |

## 4. Dev environment
- macOS, `ffmpeg` via Homebrew, Node 22, pnpm
- `.env.example` with every key above
- `make run CITY=Daltonganj` wrapper around the CLI

## 5. Open decisions
- [ ] Node vs Bun
- [ ] Remotion (React) vs pure ffmpeg render
- [ ] Which ASR for Hindi/Hinglish — needs a 5-reel bake-off
- [ ] Apify vs HikerAPI as primary managed source
- [ ] SQLite vs Postgres from day one
