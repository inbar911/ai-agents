"""Long-form YouTube picker via channel RSS.

YouTube exposes per-channel RSS at:
  https://www.youtube.com/feeds/videos.xml?channel_id=<id>
Free, no quota, no API key, no scraping of SERP.

Curated set of long-form Psychology/History/AI/Finance channels.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import feedparser
import httpx

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
)

CHANNELS: list[tuple[str, str, str]] = [
    ("Lex Fridman Podcast", "UCSHZKyawb77ixDdsGog4iWA", "AI / Psychology"),
    ("Huberman Lab", "UC2D2CMWXMOVWx7giW1n3LIg", "Psychology"),
    ("Hardcore History", "UC9_p50tH3WmMslWRWKnM7dQ", "History"),
    ("Aswath Damodaran", "UCLvnJL8htRR1T9cbSccaoVw", "Finance"),
    ("Two Minute Papers", "UCbfYPyITQ-7l4upoX8nvctg", "AI"),
    ("The Plain Bagel", "UC0X-VEW7epc60TwR5UAUk_g", "Finance"),
    ("3Blue1Brown", "UCYO_jab_esuFRV4b17AJtAw", "Math / AI"),
    ("Patrick Boyle", "UCASM0XgfkUFiqXMrPlZj1aQ", "Finance"),
]


def _fetch_channel_videos(channel_id: str) -> list[dict[str, Any]]:
    url = f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}"
    try:
        with httpx.Client(
            timeout=20, headers={"User-Agent": UA}, follow_redirects=True
        ) as client:
            r = client.get(url)
            r.raise_for_status()
            feed = feedparser.parse(r.text)
    except Exception:
        return []
    return list(feed.entries[:5])


def fetch_recent_videos(max_age_days: int = 14) -> list[dict[str, Any]]:
    cutoff = datetime.now(timezone.utc) - timedelta(days=max_age_days)
    out: list[dict[str, Any]] = []
    for channel_name, channel_id, category in CHANNELS:
        for entry in _fetch_channel_videos(channel_id):
            ts = entry.get("published_parsed")
            if ts:
                try:
                    dt = datetime(*ts[:6], tzinfo=timezone.utc)
                except Exception:
                    dt = datetime.now(timezone.utc)
                if dt < cutoff:
                    continue
            else:
                dt = datetime.now(timezone.utc)
            title = (entry.get("title") or "").strip()
            link = (entry.get("link") or "").strip()
            if not title or not link:
                continue
            out.append(
                {
                    "channel": channel_name,
                    "category": category,
                    "title": title[:300],
                    "url": link,
                    "published_at": dt.isoformat(),
                }
            )
    return out


def pick_long_form() -> dict[str, Any] | None:
    """Pick ONE long-form video. Most recent across curated channels."""
    videos = fetch_recent_videos()
    if not videos:
        return None
    videos.sort(key=lambda v: v.get("published_at", ""), reverse=True)
    return videos[0]
