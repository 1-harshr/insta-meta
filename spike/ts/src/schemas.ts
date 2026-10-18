import { z } from "zod";

export const ReelMeta = z.object({
  shortcode: z.string(),
  url: z.string(),
  caption: z.string(),
  uploader: z.string(),
  timestamp: z.number().nullable(), // unix seconds
  durationSec: z.number().nullable(),
  views: z.number().nullable(),
  likes: z.number().nullable(),
  frames: z.array(z.string()), // file names inside the reel dir
});
export type ReelMeta = z.infer<typeof ReelMeta>;

export const Transcript = z.object({
  text: z.string(),
  language: z.string(),
});

export const Hashes = z.object({ frames: z.array(z.string()) });

export const Ocr = z.object({
  lines: z.array(z.string()).describe("Every distinct piece of on-screen text, verbatim, in its original script"),
});

export const EventType = z.enum([
  "accident", "crime", "politics", "civic", "weather", "health",
  "education", "sports", "culture", "business", "other",
]);

export const Understanding = z.object({
  isNews: z.boolean().describe("A factual report of a real local event, not a promo, meme, ad, wish or motivational post"),
  isAboutCity: z.boolean().describe("The event happened in or directly concerns the target city/district"),
  summary: z.string().describe("2-3 factual English sentences. Only facts stated in the caption, transcript or on-screen text"),
  eventType: EventType,
  place: z.string().nullable().describe("Most specific place mentioned, or null"),
  people: z.array(z.string()).describe("Proper names of people mentioned, exactly as written. Never generic roles like 'police' or 'rider'"),
  newsworthiness: z.number().int().min(1).max(5).describe("1 = trivial, 5 = major event affecting many people"),
  confidence: z.number().min(0).max(1).describe("How sure you are the summary is correct given noisy inputs"),
});
export type Understanding = z.infer<typeof Understanding>;

export const StoryText = z.object({
  headline: z.string(),
  summary: z.string().describe("3-4 factual English sentences combining all reels; note any disagreements between sources"),
});

export const Story = StoryText.extend({
  id: z.string(),
  eventType: EventType,
  reels: z.array(z.string()), // shortcodes
  independentSources: z.number().int(),
  score: z.number(),
});
export type Story = z.infer<typeof Story>;

export const Bulletin = z.object({
  intro: z.string(),
  segments: z.array(
    z.object({
      storyId: z.string(),
      headline: z.string().describe("Short on-screen headline"),
      narration: z.string().describe("What the anchor says, 2-4 sentences"),
      clipShortcode: z.string().describe("Which source reel to show as B-roll"),
    }),
  ),
  outro: z.string(),
});
export type Bulletin = z.infer<typeof Bulletin>;
