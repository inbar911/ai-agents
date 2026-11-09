"""Hacker News top stories filtered to AI topics. Free Firebase API."""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

BASE = "https://hacker-news.firebaseio.com/v0"

AI_KEYWORDS = re.compile(
    r"\b("
    r"AI|LLM|LLMs|GPT|GPT-?\d|Claude|Gemini|Llama|Mistral|"
    r"Anthropic|OpenAI|DeepMind|Hugging\s?Face|"
    r"neural\s?net|machine\s?learning|deep\s?learning|"
    r"transformer|diffusion|stable\s?diffusion|"
    r"AGI|RAG|fine[-\s]?tun|prompt|embedding|"
    r"agent(?:ic)?|copilot|chatbot"
    r")\b",
    re.IGNORECASE,
)


def fetch_hn(
    min_score: int = 40, max_age_hours: int = 24, scan_limit: int = 120
) -> list[dict[str, Any]]:
    cutoff = datetime.now(timezone.utc) - timedelta(hours=max_age_hours)
    out: list[dict[str, Any]] = []
    with httpx.Client(timeout=20) as client:
        try:
            r = client.get(f"{BASE}/topstories.json")
            r.raise_for_status()
            ids = r.json()[:scan_limit]
        except Exception:
            return []
        for sid in ids:
            try:
                r = client.get(f"{BASE}/item/{sid}.json")
                r.raise_for_status()
                item = r.json()
            except Exception:
                continue
            if not isinstance(item, dict) or item.get("type") != "story":
                continue
            score = int(item.get("score") or 0)
            if score < min_score:
                continue
            ts = datetime.fromtimestamp(int(item.get("time") or 0), tz=timezone.utc)
            if ts < cutoff:
                continue
            title = item.get("title") or ""
            url = item.get("url") or f"https://news.ycombinator.com/item?id={sid}"
            haystack = f"{title} {url}"
            if not AI_KEYWORDS.search(haystack):
                continue
            comments = int(item.get("descendants") or 0)
            out.append(
                {
                    "source": "Hacker News",
                    "url": url,
                    "title": title[:300],
                    "summary": f"HN: {score} points, {comments} comments",
                    "published_at": ts.isoformat(),
                    "rank_score": float(score + 0.5 * comments),
                }
            )
    return out
