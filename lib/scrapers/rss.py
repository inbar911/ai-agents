"""AI blog RSS aggregation. No API keys, no quotas."""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any

import feedparser

AI_FEEDS: list[tuple[str, str]] = [
    ("Hugging Face", "https://huggingface.co/blog/feed.xml"),
    ("OpenAI", "https://openai.com/blog/rss.xml"),
    ("Anthropic", "https://www.anthropic.com/news/rss.xml"),
    ("Google AI", "https://blog.google/technology/ai/rss/"),
    ("DeepMind", "https://deepmind.google/blog/rss.xml"),
    ("Meta AI", "https://ai.meta.com/blog/rss/"),
    ("NVIDIA AI", "https://blogs.nvidia.com/blog/category/deep-learning/feed/"),
    ("MIT News AI", "https://news.mit.edu/topic/mitartificial-intelligence2-rss.xml"),
]


def _strip_html(text: str) -> str:
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def fetch_rss(max_age_hours: int = 72, per_feed_limit: int = 10) -> list[dict[str, Any]]:
    cutoff = datetime.now(timezone.utc) - timedelta(hours=max_age_hours)
    out: list[dict[str, Any]] = []
    for source, url in AI_FEEDS:
        try:
            feed = feedparser.parse(url)
        except Exception:
            continue
        for entry in feed.entries[:per_feed_limit]:
            published = entry.get("published_parsed") or entry.get("updated_parsed")
            if published:
                dt = datetime(*published[:6], tzinfo=timezone.utc)
                if dt < cutoff:
                    continue
            else:
                dt = datetime.now(timezone.utc)
            link = entry.get("link") or ""
            title = entry.get("title") or ""
            if not link or not title:
                continue
            raw_summary = entry.get("summary") or entry.get("description") or ""
            out.append(
                {
                    "source": source,
                    "url": link.strip(),
                    "title": title.strip()[:300],
                    "summary": _strip_html(raw_summary)[:500],
                    "published_at": dt.isoformat(),
                    "rank_score": 50.0,
                }
            )
    return out
