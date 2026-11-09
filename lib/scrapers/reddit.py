"""Reddit complaint scraper. Unauth JSON endpoints, free, rate-limited.

Detects complaint patterns in post titles + selftext using regex.
Reddit is hostile to scrapers — uses a custom UA and backs off on 429/403.
"""
from __future__ import annotations

import hashlib
import re
import time
from typing import Any

import httpx

UA = "ai-agents-pain-miner/1.0 (personal research, single-user)"

DEFAULT_SUBS: list[str] = [
    "SaaS",
    "Entrepreneur",
    "sysadmin",
    "webdev",
    "smallbusiness",
    "freelance",
    "productivity",
]

COMPLAINT_PATTERNS = re.compile(
    r"\b("
    r"i\s+wish|wish\s+there\s+(?:was|were)|"
    r"why\s+is(?:n'?t|\s+not)\s+there|"
    r"is\s+there\s+a\s+tool|looking\s+for\s+a\s+tool|need\s+a\s+tool|"
    r"frustrat(?:ed|ing)|sucks|hate\s+(?:when|that|how)|"
    r"painful|annoying|tedious|broken|"
    r"no\s+good\s+(?:tool|way)|nothing\s+works|"
    r"why\s+can'?t\s+i|how\s+do\s+i|tired\s+of|stuck\s+(?:on|with)|"
    r"struggl(?:e|ing)|nightmare|impossible"
    r")\b",
    re.IGNORECASE,
)


def complaint_hash(url: str, title: str) -> str:
    return hashlib.sha1(f"{url}|{title}".encode("utf-8")).hexdigest()[:32]


def fetch_subreddit_posts(
    sub: str, limit: int = 50, time_filter: str = "week"
) -> list[dict[str, Any]]:
    url = f"https://www.reddit.com/r/{sub}/top.json"
    params = {"limit": limit, "t": time_filter}
    out: list[dict[str, Any]] = []
    try:
        with httpx.Client(
            timeout=20,
            headers={"User-Agent": UA, "Accept": "application/json"},
            follow_redirects=True,
        ) as client:
            for attempt in range(3):
                r = client.get(url, params=params)
                if r.status_code in (429, 503):
                    time.sleep(5 * (attempt + 1))
                    continue
                if r.status_code in (401, 403):
                    return []
                r.raise_for_status()
                data = r.json()
                break
            else:
                return []
    except Exception:
        return []

    for child in data.get("data", {}).get("children", []):
        post = child.get("data") or {}
        if post.get("stickied") or post.get("over_18"):
            continue
        title = (post.get("title") or "").strip()
        selftext = (post.get("selftext") or "").strip()
        if not title:
            continue
        permalink = post.get("permalink") or ""
        out.append(
            {
                "subreddit": sub,
                "title": title[:300],
                "selftext": selftext[:1500],
                "url": f"https://www.reddit.com{permalink}" if permalink else "",
                "score": int(post.get("score") or 0),
                "num_comments": int(post.get("num_comments") or 0),
                "created_utc": float(post.get("created_utc") or 0),
            }
        )
    return out


def fetch_complaints(
    subs: list[str] | None = None,
    posts_per_sub: int = 50,
    time_filter: str = "week",
    polite_sleep_seconds: float = 1.5,
) -> list[dict[str, Any]]:
    targets = subs or DEFAULT_SUBS
    out: list[dict[str, Any]] = []
    for sub in targets:
        posts = fetch_subreddit_posts(sub, limit=posts_per_sub, time_filter=time_filter)
        for p in posts:
            haystack = f"{p['title']} {p['selftext']}"
            if not COMPLAINT_PATTERNS.search(haystack):
                continue
            p["hash"] = complaint_hash(p["url"], p["title"])
            out.append(p)
        time.sleep(polite_sleep_seconds)
    return out
