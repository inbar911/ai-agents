"""Agent 2 — Scout.

Daily AI news digest. Pulls from:
- RSS feeds of major AI labs (Hugging Face, OpenAI, Anthropic, etc.)
- Hacker News top stories filtered to AI keywords
- GitHub Trending AI repos (daily)

Dedups by URL against `ai_updates`, scores, stores, returns a markdown digest.
No LLM calls — Orchestrator handles final summarization for the combined brief.

Run: `python -m agents.scout.main`
"""
from __future__ import annotations

import asyncio
import sys
from typing import Any

from lib.scrapers.github_trending import fetch_github_trending
from lib.scrapers.hn import fetch_hn
from lib.scrapers.rss import fetch_rss
from lib.llm import ask_json
from lib.profile import who
from lib.supabase_client import log_run, sb

MAX_AGE_HOURS = 24
DIGEST_SIZE = 5


def collect_all() -> list[dict[str, Any]]:
    sources: list[tuple[str, Any]] = [
        ("rss", fetch_rss),
        ("hn", fetch_hn),
        ("github", fetch_github_trending),
    ]
    items: list[dict[str, Any]] = []
    for name, fn in sources:
        try:
            res = fn() if name != "rss" else fn(max_age_hours=MAX_AGE_HOURS * 3)
            items.extend(res)
            print(f"[scout] {name}: {len(res)} items", file=sys.stderr)
        except Exception as e:
            print(f"[scout] {name} FAILED: {e}", file=sys.stderr)
    return items


def dedup_against_db(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not items:
        return []
    urls = list({i["url"] for i in items if i.get("url")})
    seen: set[str] = set()
    for chunk_start in range(0, len(urls), 200):
        chunk = urls[chunk_start : chunk_start + 200]
        res = (
            sb()
            .table("ai_updates")
            .select("url")
            .in_("url", chunk)
            .execute()
        )
        seen.update(row["url"] for row in res.data)
    return [i for i in items if i.get("url") and i["url"] not in seen]


def store_updates(items: list[dict[str, Any]]) -> int:
    if not items:
        return 0
    rows = [
        {
            "url": i["url"],
            "source": i["source"],
            "title": i["title"][:300],
            "summary": (i.get("summary") or "")[:1000],
            "score": float(i.get("rank_score") or 0),
        }
        for i in items
    ]
    res = (
        sb()
        .table("ai_updates")
        .upsert(rows, on_conflict="url", ignore_duplicates=True)
        .execute()
    )
    return len(res.data or [])


def render_digest(items: list[dict[str, Any]]) -> str:
    """The day's 5 most interesting items, each with one plain Hebrew sentence (Inbar got bare link lists before)."""
    if not items:
        return "_אין עדכוני AI חדשים היום._"
    top = sorted(items, key=lambda x: x.get("rank_score", 0), reverse=True)[:DIGEST_SIZE * 3]
    try:
        out = ask_json(
            f"You pick AI/tech news for Inbar, {who()}. From the items, choose the "
            f"{DIGEST_SIZE} most useful or exciting for him and explain each in ONE short plain Hebrew sentence "
            "(what it is + why it matters to a builder). No hype. "
            'Return JSON: {"picks": [{"i": <item index>, "he": "<Hebrew sentence>"}]}',
            {"items": [{"i": k, "title": x["title"], "source": x["source"]} for k, x in enumerate(top)]},
            max_tokens=1200,
        )
        picks = [(top[p["i"]], str(p["he"]).strip()) for p in out.get("picks", [])
                 if isinstance(p, dict) and isinstance(p.get("i"), int) and 0 <= p["i"] < len(top) and p.get("he")][:DIGEST_SIZE]
    except Exception as e:  # noqa: BLE001 — the digest still goes out, just without the explanations
        print(f"[scout] explain failed: {e}", file=sys.stderr)
        picks = []
    if not picks:
        picks = [(x, "") for x in top[:DIGEST_SIZE]]
    lines = ["## 🤖 חדשות AI"]
    for x, he in picks:
        lines.append(f"- {he or x['title']}\n  [{x['title']}]({x['url']})")
    return "\n".join(lines)


async def run() -> dict[str, Any]:
    try:
        raw = collect_all()
        print(f"[scout] collected {len(raw)} raw items", file=sys.stderr)

        new_items = dedup_against_db(raw)
        print(f"[scout] {len(new_items)} new (after DB dedup)", file=sys.stderr)

        seen_urls: set[str] = set()
        unique_new: list[dict[str, Any]] = []
        for i in new_items:
            if i["url"] in seen_urls:
                continue
            seen_urls.add(i["url"])
            unique_new.append(i)

        inserted = store_updates(unique_new)
        print(f"[scout] inserted {inserted} rows", file=sys.stderr)

        digest = render_digest(unique_new)
        log_run("scout", "ok", inserted)
        return {
            "digest": digest,
            "fetched": len(raw),
            "new": len(unique_new),
            "inserted": inserted,
        }
    except Exception as e:
        try:
            log_run("scout", "error", 0, str(e)[:500])
        except Exception:
            pass
        raise


if __name__ == "__main__":
    result = asyncio.run(run())
    print("\n=== Scout digest ===\n")
    print(result["digest"])
    print(
        f"\n[fetched: {result['fetched']}, new: {result['new']}, "
        f"inserted: {result['inserted']}]"
    )
