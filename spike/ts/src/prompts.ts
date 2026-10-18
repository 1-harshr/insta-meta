// Prompts live here so the pipeline and the eval harness use exactly the same text.
import type { Config } from "./core.js";

export type ReelInput = {
  uploader: string;
  postedAt: string; // ISO or "unknown"
  caption: string;
  ocr: string[];
  transcript: string;
  transcriptLang: string;
};

export function understandPrompt(config: Pick<Config, "city" | "aliases">, r: ReelInput): string {
  return `You extract facts from one Instagram reel for a local news digest about ${config.city} (also known as: ${config.aliases.join(", ")}).

Rules:
- Use ONLY facts present in the inputs below. Never add names, numbers, places or causes that are not there.
- Local usage: "बाइक" means motorbike. Keep local proper nouns as transliterations, do not "correct" them into other words (e.g. सदर अस्पताल = "Sadar Hospital", not "Sardar").
- Inputs are noisy: the transcript is automatic speech recognition and may be wrong, or may be song lyrics / background music. On-screen text is usually the most reliable source.
- If the inputs are too thin to say what happened, set isNews=false or give low confidence.
- people: ONLY proper names of specific persons (e.g. "Ramesh Yadav", "SP Reeshma Ramesan"). Roles or groups like "police", "rider", "villagers", "driver" are NOT people. If no person is named, return [].
- place: transliterate the place name as spelled in the on-screen text (if present), using standard spellings for common words: चौक = Chowk, बाज़ार = Bazar, मोड़ = More, नगर = Nagar. Then add the city, e.g. "Redma Chowk, Daltonganj".

Posted by: @${r.uploader}
Posted at: ${r.postedAt}

CAPTION:
${r.caption || "(none)"}

ON-SCREEN TEXT:
${r.ocr.length ? r.ocr.join("\n") : "(none)"}

SPEECH TRANSCRIPT (${r.transcriptLang}):
${r.transcript || "(none)"}`;
}
