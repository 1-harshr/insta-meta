"""Local media analysis for each reel dir: speech-to-text (mlx-whisper) + perceptual hashes of keyframes.

Usage: uv run media.py <run_dir> <whisper_hf_repo>
Writes transcript.json and hashes.json next to each reel's meta.json. Skips reels already done.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import TypedDict

import imagehash
import mlx_whisper
from PIL import Image


class Transcript(TypedDict):
    text: str
    language: str


class Hashes(TypedDict):
    frames: list[str]


def transcribe(audio: Path, model: str) -> Transcript:
    if not audio.exists():
        return {"text": "", "language": "none"}
    result = mlx_whisper.transcribe(str(audio), path_or_hf_repo=model, condition_on_previous_text=False)
    text = str(result.get("text", "")).strip()
    return {"text": text, "language": str(result.get("language", "unknown"))}


def frame_hashes(reel_dir: Path, frames: list[str]) -> Hashes:
    return {"frames": [str(imagehash.phash(Image.open(reel_dir / f))) for f in frames]}


def main() -> None:
    run_dir, model = Path(sys.argv[1]), sys.argv[2]
    reel_dirs = sorted(p.parent for p in (run_dir / "reels").glob("*/meta.json"))
    for i, d in enumerate(reel_dirs, 1):
        meta = json.loads((d / "meta.json").read_text())
        if not (d / "hashes.json").exists():
            (d / "hashes.json").write_text(json.dumps(frame_hashes(d, meta["frames"])))
        if not (d / "transcript.json").exists():
            t = transcribe(d / "audio.wav", model)
            (d / "transcript.json").write_text(json.dumps(t, ensure_ascii=False, indent=2))
            print(f"[{i}/{len(reel_dirs)}] {d.name}: {t['language']}, {len(t['text'])} chars", flush=True)


if __name__ == "__main__":
    main()
