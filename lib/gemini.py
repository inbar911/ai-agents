"""Gemini text -> one JSON object, for every agent that writes with Gemini. When Gemini's free quota is out it
answers with Groq instead, so a run never loses its scripts, study sessions or rules to a 429."""
from __future__ import annotations

import json
import sys
import time
from typing import Any

import httpx

from lib.bot_data import bot_secret
from lib.llm import ask_json
from lib.usage import gemini_tokens, track

URL = "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent"
MODELS = ["gemini-2.5-flash", "gemini-2.5-flash", "gemini-2.5-flash-lite"]

# models whose DAILY free quota ran out during this run: asking them again only waits for another 429
_spent: set[str] = set()


def _daily(r: httpx.Response) -> bool:
    return r.status_code == 429 and "PerDay" in r.text


def gemini_json(prompt: str, temperature: float = 0.6, models: list[str] = MODELS, timeout: int = 180) -> dict[str, Any]:
    key = bot_secret("gemini_key")
    for i, model in enumerate(models if key else []):
        if model in _spent:
            continue
        try:
            r = httpx.post(URL.format(model), headers={"x-goog-api-key": key}, timeout=timeout, json={
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {"responseMimeType": "application/json", "temperature": temperature},
            })
        except httpx.HTTPError as e:
            print(f"[gemini] {model}: {type(e).__name__}", file=sys.stderr)
            track("gemini", model, 0)
            continue
        track("gemini", model, r.status_code, gemini_tokens(r.json()) if r.is_success else None)
        if _daily(r):
            _spent.add(model)
            print(f"[gemini] {model}: daily quota is out", file=sys.stderr)
            continue
        if r.status_code in (429, 500, 503):
            # a per-minute limit or a short overload: wait it out before the next model
            if i < len(models) - 1:
                time.sleep(15 * (i + 1))
            continue
        r.raise_for_status()
        try:
            out = json.loads(r.json()["candidates"][0]["content"]["parts"][0]["text"])
        except (KeyError, IndexError, ValueError):
            continue
        if isinstance(out, dict):
            return out
    print("[gemini] unavailable -> Groq", file=sys.stderr)
    return ask_json("Follow the instructions in the user message exactly. Answer with ONE JSON object and nothing else.",
                    prompt, max_tokens=4000, temperature=temperature)
