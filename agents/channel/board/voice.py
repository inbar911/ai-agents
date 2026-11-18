"""Two voices in ONE Gemini TTS request (Noa = Puck, Claude = Achird), each line read with its emotion, then Groq Whisper
word times split the dialogue into one WAV per line, cut in the real pauses between speakers.
Writes work/voices/<id>.wav, work/voices/words.json (word times per line, from the line's start) and work/voices/vo.json."""
from __future__ import annotations

import base64
import json
import re
import time
import wave
from pathlib import Path
from typing import Any

import httpx
import numpy as np

from agents.channel.voice import QuotaExhausted, _words
from lib.bot_data import bot_secret
from lib.usage import gemini_tokens, track

RATE = 24000
VOICES = {"noa": ("Noa", "Puck"), "claude": ("Claude", "Achird")}


def _speak(lines: list[dict[str, Any]]) -> np.ndarray:
    convo = "\n".join(f"{VOICES[L['speaker']][0]}: ({L['emotion']}) {L['text']}" for L in lines)
    prompt = ("Read this short, lively Instagram Reels dialogue between two American guys. Noa is a curious young guy, "
              "upbeat and expressive. Claude is a warm, friendly, charismatic explainer with a smile in his voice. "
              "Real emotion, natural casual American English, punchy emphasis, never flat or robotic, full clear volume. "
              "Each line's direction in parentheses says how to read it; never read the directions aloud. "
              "Leave a short natural pause between lines.\n\n" + convo)
    key = bot_secret("gemini_key")
    for attempt in range(4):
        r = httpx.post("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent",
                       headers={"x-goog-api-key": key}, timeout=300,
                       json={"contents": [{"parts": [{"text": prompt}]}],
                             "generationConfig": {"responseModalities": ["AUDIO"], "speechConfig": {"multiSpeakerVoiceConfig": {"speakerVoiceConfigs": [
                                 {"speaker": n, "voiceConfig": {"prebuiltVoiceConfig": {"voiceName": v}}} for n, v in VOICES.values()]}}}})
        track("gemini", "gemini-2.5-flash-preview-tts", r.status_code, gemini_tokens(r.json()) if r.is_success else None)
        if r.status_code == 429:
            if "PerDay" in r.text:
                raise QuotaExhausted("Gemini TTS daily free quota is used up (resets ~10:00 Israel time)")
            time.sleep(25 * (attempt + 1))
            continue
        r.raise_for_status()
        pcm = base64.b64decode(r.json()["candidates"][0]["content"]["parts"][0]["inlineData"]["data"])
        return np.frombuffer(pcm, np.int16).astype(np.float32) / 32768
    raise RuntimeError("Gemini TTS kept rate-limiting")


def _write(path: Path, x: np.ndarray) -> None:
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype(np.int16).tobytes())


def _gaps(audio: np.ndarray) -> list[tuple[float, float]]:
    """Quiet stretches of 120 ms or more (start, end) in seconds."""
    n = len(audio) // 240
    env = np.sqrt((audio[: n * 240].reshape(n, 240) ** 2).mean(1))        # 10 ms RMS
    quiet = env < max(1e-4, np.percentile(env, 95) * .04)
    out, i0 = [], None
    for j, q in enumerate(quiet):
        if q and i0 is None: i0 = j
        if not q and i0 is not None:
            if j - i0 >= 12: out.append((i0 / 100, j / 100))
            i0 = None
    return out


def narrate(lines: list[dict[str, Any]], work: Path) -> float:
    vdir = work / "voices"; vdir.mkdir(exist_ok=True)
    audio = np.concatenate([np.zeros(int(.05 * RATE), np.float32), _speak(lines)])
    full = vdir / "dialogue.wav"; _write(full, audio)
    words = [w for w in _words(full, "en") if str(w.get("word", "")).strip()]
    if not words:
        raise RuntimeError("no word timings for the dialogue")
    counts = [len(L["text"].split()) for L in lines]
    scale = len(words) / max(1, sum(counts))          # the recogniser may split or merge a few words
    bounds, cum = [], 0
    for c in counts:
        i0 = min(len(words) - 1, round(cum * scale)); i1 = min(len(words) - 1, max(i0, round((cum + c) * scale) - 1))
        bounds.append((float(words[i0]["start"]), float(words[i1]["end"]), i0, i1)); cum += c
    gaps = _gaps(audio)
    cuts = []
    for k in range(1, len(bounds)):
        guess = (bounds[k - 1][1] + bounds[k][0]) / 2
        near = [g for g in gaps if abs((g[0] + g[1]) / 2 - guess) < .9]
        cuts.append(max(near, key=lambda g: g[1] - g[0]) if near else (guess - .05, guess + .05))
    vo, wj = {}, {}
    for k, L in enumerate(lines):
        a = cuts[k - 1][1] - .06 if k else 0.
        b = cuts[k][0] + .1 if k < len(cuts) else len(audio) / RATE
        seg = audio[int(a * RATE):int(b * RATE)].copy()
        f = min(len(seg) // 2, int(.01 * RATE)); seg[:f] *= np.linspace(0, 1, f); seg[len(seg) - f:] *= np.linspace(1, 0, f)
        _write(vdir / f"{L['id']}.wav", seg)
        vo[L["id"]] = round(a, 3)
        wj[L["id"]] = [[re.sub(r"\s+", "", str(w["word"])), round(float(w["start"]) - a, 3), round(float(w["end"]) - a, 3)]
                       for w in words if a - .05 <= float(w["start"]) < b]
    (vdir / "vo.json").write_text(json.dumps(vo, indent=1))
    (vdir / "words.json").write_text(json.dumps(wj, ensure_ascii=False))
    return len(audio) / RATE
