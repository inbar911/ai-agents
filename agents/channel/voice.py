"""Narration: ONE Gemini TTS request per video (the free tier allows 10 a day), then Groq Whisper word
timestamps decide where each script line starts, so scenes and captions follow the real voice."""
from __future__ import annotations

import base64
import json
import shutil
import subprocess
import sys
import time
import wave
from pathlib import Path
from typing import Any

import httpx

from lib.bot_data import bot_secret

RATE = 24000
VOICE = "Puck"
LOUD = ("Speak out loud at full, clear, confident volume, like presenting to a room. Do not whisper, mutter or drop "
        "to a hushed voice unless that one line's direction explicitly says whisper; go straight back to full voice after it.")
STYLE = {
    "he": "You are a charismatic Israeli tech creator on Instagram. Speak fluent, native Hebrew with real emotion: "
          "curiosity, surprise, a smile in the voice, natural pauses and emphasis. Never flat or robotic. " + LOUD,
    "en": "You are a charismatic American tech creator on Instagram Reels. Speak natural, fast-paced casual American English "
          "with real emotion: curiosity, surprise, a smile in the voice, punchy emphasis. Never flat or robotic. " + LOUD,
}


class QuotaExhausted(RuntimeError):
    pass


def _speak(prompt: str) -> bytes:
    key = bot_secret("gemini_key")
    for attempt in range(4):
        r = httpx.post(
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent",
            headers={"x-goog-api-key": key}, timeout=240,
            json={"contents": [{"parts": [{"text": prompt}]}],
                  "generationConfig": {"responseModalities": ["AUDIO"],
                                       "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": VOICE}}}}})
        if r.status_code == 429:
            if "PerDay" in r.text:
                raise QuotaExhausted("Gemini TTS daily free quota is used up (resets ~10:00 Israel time)")
            time.sleep(25 * (attempt + 1))
            continue
        r.raise_for_status()
        return base64.b64decode(r.json()["candidates"][0]["content"]["parts"][0]["inlineData"]["data"])
    raise RuntimeError("Gemini TTS kept rate-limiting")


def _words(wav: Path, lang: str) -> list[dict[str, Any]]:
    r = httpx.post("https://api.groq.com/openai/v1/audio/transcriptions", timeout=240,
                   headers={"Authorization": f"Bearer {bot_secret('groq_key')}"},
                   data={"model": "whisper-large-v3", "language": lang, "response_format": "verbose_json",
                         "timestamp_granularities[]": "word"},
                   files={"file": ("n.wav", wav.read_bytes(), "audio/wav")})
    r.raise_for_status()
    return r.json().get("words") or []


# Render time grows with length: 35s+ reels (8.11) blew the 30-minute render limit on GitHub's 2-core runner,
# and the best reels so far were 24-29s anyway. Longer narration is sped up (up to 1.2x) to fit.
MAX_SECONDS = 30.0


def _fit(wav: Path, length: float) -> float:
    tempo = min(length / MAX_SECONDS, 1.2)
    tmp = wav.with_name("narration-fit.wav")
    subprocess.run([shutil.which("ffmpeg") or "ffmpeg", "-v", "error", "-y", "-i", str(wav), "-filter:a", f"atempo={tempo:.3f}",
                    "-ar", str(RATE), "-ac", "1", str(tmp)], check=True, timeout=120)
    tmp.replace(wav)
    with wave.open(str(wav), "rb") as w:
        fitted = w.getnframes() / w.getframerate()
    print(f"[channel] narration {length:.1f}s sped x{tempo:.2f} -> {fitted:.1f}s", file=sys.stderr)
    return fitted


def narrate(segments: list[dict[str, Any]], work: Path, lang: str = "he") -> float:
    """Writes work/narration.wav and work/timing.js; returns the narration length in seconds."""
    lines = "\n".join(f"[{s['tone']}] {s.get('say') or s['text'].replace('*', '')}" for s in segments)
    prompt = (f"{STYLE[lang]}\nRead these lines in order, with a short natural pause between lines. The bracketed text "
              f"before each line is a direction for how to say it; never read it aloud.\n\n{lines}")
    audio = b"\0\0" * int(RATE * 0.05) + _speak(prompt)   # talk from the first frame: viewers decide within a second
    with wave.open(str(work / "narration.wav"), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE); w.writeframes(audio)
    length = len(audio) / 2 / RATE
    if length > MAX_SECONDS:
        length = _fit(work / "narration.wav", length)

    words = _words(work / "narration.wav", lang)
    counts = [len(s["text"].split()) for s in segments]
    total, n = sum(counts), len(words)
    timing, cum = [], 0
    for c in counts:
        if n:
            i0 = min(round(cum * n / total), n - 1)
            i1 = min(max(round((cum + c) * n / total) - 1, i0), n - 1)
            a, b = float(words[i0]["start"]), float(words[i1]["end"])
        else:  # no transcript: spread the lines by length
            a, b = 0.3 + (length - 0.3) * cum / total, 0.3 + (length - 0.3) * (cum + c) / total
        timing.append({"a": round(a, 3), "b": round(max(b, a + 0.4), 3)})
        cum += c
    # when the follow word is spoken: the follow button is tapped on exactly that word
    fw = [w for w in words if any(k in str(w.get("word", w.get("text", ""))).lower() for k in ("follow", "תעקבו", "עקבו"))]
    if fw and timing:
        timing[-1]["f"] = round(float(fw[-1]["start"]), 3)
    (work / "timing.js").write_text("window.TIMING = " + json.dumps(timing) + ";\n", encoding="utf-8")
    return length
