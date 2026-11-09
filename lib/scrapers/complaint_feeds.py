"""Complaint mining via RSS feeds (Reddit RSS, HN Ask, Lobsters, dev.to).

Reddit blocks unauth JSON in 2026, but RSS endpoints are still open and free.
We fetch RSS for the configured subreddits + other complaint-rich sources,
then filter for complaint patterns.
"""
from __future__ import annotations

import hashlib
import re
from datetime import datetime, timedelta, timezone
from typing import Any

import feedparser
import httpx

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
)

DEFAULT_SUBS: list[str] = [
    "SaaS",
    "Entrepreneur",
    "sysadmin",
    "webdev",
    "smallbusiness",
    "freelance",
    "productivity",
]

EXTRA_FEEDS: list[tuple[str, str]] = [
    ("HN Ask", "https://hnrss.org/ask"),
    ("HN Best", "https://hnrss.org/best"),
    ("Lobsters", "https://lobste.rs/rss"),
    ("dev.to", "https://dev.to/feed"),
]

COMPLAINT_PATTERNS = re.compile(
    r"\b("
    r"i\s+wish|wish\s+there\s+(?:was|were)|"
    r"why\s+is(?:n'?t|\s+not)\s+there|"
    r"is\s+there\s+a\s+tool|looking\s+for\s+a\s+tool|"
    r"need\s+(?:a\s+)?tool|recommend\s+a\s+tool|"
    r"frustrat(?:ed|ing)|sucks|hate\s+(?:when|that|how)|"
    r"painful|annoying|tedious|broken|"
    r"no\s+good\s+(?:tool|way|solution)|nothing\s+works|"
    r"why\s+can'?t\s+i|how\s+do\s+i|tired\s+of|stuck\s+(?:on|with)|"
    r"struggl(?:e|ing)|nightmare|impossible|"
    r"alternative\s+to|replacement\s+for|"
    r"any\s+(?:good|better)|recommendations?\?"
    r")\b",
    re.IGNORECASE,
)


def complaint_hash(url: str, title: str) -> str:
    return hashlib.sha1(f"{url}|{title}".encode("utf-8")).hexdigest()[:32]


def _strip_html(text: str) -> str:
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _fetch_rss(url: str) -> Any:
    try:
        with httpx.Client(
            timeout=20,
            headers={"User-Agent": UA},
            follow_redirects=True,
        ) as client:
            r = client.get(url)
            r.raise_for_status()
            return feedparser.parse(r.text)
    except Exception:
        return None


def _entries_to_complaints(
    feed: Any, source: str, max_age_hours: int
) -> list[dict[str, Any]]:
    if not feed or not getattr(feed, "entries", None):
        return []
    cutoff = datetime.now(timezone.utc) - timedelta(hours=max_age_hours)
    out: list[dict[str, Any]] = []
    for entry in feed.entries:
        ts = entry.get("published_parsed") or entry.get("updated_parsed")
        if ts:
            try:
                dt = datetime(*ts[:6], tzinfo=timezone.utc)
                if dt < cutoff:
                    continue
            except Exception:
                pass
        link = (entry.get("link") or "").strip()
        title = (entry.get("title") or "").strip()
        if not link or not title:
            continue
        raw_summary = entry.get("summary") or entry.get("description") or ""
        summary = _strip_html(raw_summary)[:1500]
        haystack = f"{title} {summary}"
        if not COMPLAINT_PATTERNS.search(haystack):
            continue
        out.append(
            {
                "subreddit": source,
                "title": title[:300],
                "selftext": summary,
                "url": link,
                "score": 0,
                "num_comments": 0,
                "created_utc": 0,
                "hash": complaint_hash(link, title),
            }
        )
    return out


def fetch_complaints_via_feeds(
    subs: list[str] | None = None,
    max_age_hours: int = 168,
) -> list[dict[str, Any]]:
    targets = subs or DEFAULT_SUBS
    out: list[dict[str, Any]] = []

    for sub in targets:
        url = f"https://www.reddit.com/r/{sub}/top.rss?t=week"
        feed = _fetch_rss(url)
        out.extend(_entries_to_complaints(feed, f"r/{sub}", max_age_hours))

    for source, url in EXTRA_FEEDS:
        feed = _fetch_rss(url)
        out.extend(_entries_to_complaints(feed, source, max_age_hours))

    seen_urls: set[str] = set()
    unique: list[dict[str, Any]] = []
    for c in out:
        if c["url"] in seen_urls:
            continue
        seen_urls.add(c["url"])
        unique.append(c)
    return unique
