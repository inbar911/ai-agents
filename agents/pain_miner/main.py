"""Agent 3 — Pain-Miner.

Combines two streams of complaints:
- Reddit posts from default subs (SaaS, Entrepreneur, sysadmin, webdev, ...)
- Opportunity-tagged emails from Gatekeeper (Agent 1)

Clusters them via Groq into EXACTLY 5 Micro-SaaS ideas, dedups against
`ideas_history` by fingerprint, and stores the new ones.

Run: `python -m agents.pain_miner.main`
"""
from __future__ import annotations

import asyncio
import re
import sys
from typing import Any

from lib.llm import mine_ideas
from lib.scrapers.complaint_feeds import DEFAULT_SUBS, fetch_complaints_via_feeds
from lib.supabase_client import log_run, sb


def fetch_email_opportunities(limit: int = 30) -> list[dict[str, Any]]:
    res = (
        sb()
        .table("opportunities")
        .select("from_addr,subject,complaint,domain,gmail_message_id,created_at")
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return res.data or []


def fetch_existing_fingerprints() -> set[str]:
    res = sb().table("ideas_history").select("fingerprint").execute()
    return {row["fingerprint"] for row in (res.data or [])}


def filter_processed_complaints(
    complaints: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    if not complaints:
        return []
    hashes = [c["hash"] for c in complaints if c.get("hash")]
    seen: set[str] = set()
    for start in range(0, len(hashes), 200):
        chunk = hashes[start : start + 200]
        res = (
            sb()
            .table("processed_complaints")
            .select("hash")
            .in_("hash", chunk)
            .execute()
        )
        seen.update(row["hash"] for row in (res.data or []))
    return [c for c in complaints if c.get("hash") and c["hash"] not in seen]


def mark_complaints_processed(complaints: list[dict[str, Any]]) -> None:
    if not complaints:
        return
    rows = [
        {"hash": c["hash"], "source": "reddit", "url": c.get("url", "")}
        for c in complaints
        if c.get("hash")
    ]
    if not rows:
        return
    sb().table("processed_complaints").upsert(
        rows, on_conflict="hash", ignore_duplicates=True
    ).execute()


def make_fingerprint(idea: dict[str, Any]) -> str:
    base = f"{idea['title']} {idea.get('problem', '')[:60]}".lower()
    slug = re.sub(r"[^a-z0-9]+", "-", base).strip("-")
    return slug[:80] or re.sub(r"[^a-z0-9]+", "-", idea["title"].lower())[:80]


def build_payload(
    web_complaints: list[dict[str, Any]], email_opps: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    payload: list[dict[str, Any]] = []
    for c in web_complaints:
        payload.append(
            {
                "source": c.get("subreddit") or "web",
                "url": c.get("url", ""),
                "title": c.get("title", "")[:200],
                "body": (c.get("selftext") or "")[:500],
            }
        )
    for o in email_opps:
        payload.append(
            {
                "source": f"email/{(o.get('from_addr') or '')[:40]}",
                "url": "",
                "title": o.get("subject", "")[:200],
                "body": (o.get("complaint") or "")[:500],
            }
        )
    return payload


def store_ideas(ideas: list[dict[str, Any]]) -> int:
    if not ideas:
        return 0
    rows = [
        {
            "fingerprint": i["fingerprint"],
            "title": i["title"][:200],
            "problem": i["problem"][:1000],
            "target_user": (i.get("target_user") or "")[:200],
            "solution": i["solution"][:1000],
            "evidence": i.get("evidence") or [],
        }
        for i in ideas
    ]
    res = (
        sb()
        .table("ideas_history")
        .upsert(rows, on_conflict="fingerprint", ignore_duplicates=True)
        .execute()
    )
    return len(res.data or [])


def render_ideas_report(ideas: list[dict[str, Any]]) -> str:
    if not ideas:
        return "_אין רעיונות חדשים החודש מהמקורות הקיימים._"
    lines: list[str] = ["# Pain-Miner — 5 רעיונות Micro-SaaS", ""]
    for idx, idea in enumerate(ideas, start=1):
        lines.append(f"## {idx}. {idea['title']}")
        lines.append(f"**Problem:** {idea['problem']}")
        if idea.get("target_user"):
            lines.append(f"**Target user:** {idea['target_user']}")
        lines.append(f"**Solution:** {idea['solution']}")
        if idea.get("evidence"):
            lines.append("**Evidence:**")
            for ev in idea["evidence"]:
                lines.append(f"  - {ev}")
        lines.append("")
    return "\n".join(lines).rstrip()


async def run(subs: list[str] | None = None) -> dict[str, Any]:
    try:
        web = await asyncio.to_thread(
            fetch_complaints_via_feeds, subs or DEFAULT_SUBS, 168
        )
        print(f"[pain_miner] feed raw complaints: {len(web)}", file=sys.stderr)

        new_web = filter_processed_complaints(web)
        print(f"[pain_miner] new web complaints: {len(new_web)}", file=sys.stderr)

        email_opps = fetch_email_opportunities(limit=30)
        print(f"[pain_miner] email opportunities: {len(email_opps)}", file=sys.stderr)

        payload = build_payload(new_web, email_opps)
        if not payload:
            log_run("pain_miner", "ok", 0)
            return {"report": "_אין תלונות חדשות לכרייה._", "ideas": []}

        existing = fetch_existing_fingerprints()
        print(
            f"[pain_miner] existing fingerprints: {len(existing)}", file=sys.stderr
        )

        ideas = mine_ideas(payload, avoid_fingerprints=list(existing))
        print(f"[pain_miner] LLM returned {len(ideas)} ideas", file=sys.stderr)

        new_ideas: list[dict[str, Any]] = []
        for idea in ideas:
            fp = make_fingerprint(idea)
            if fp in existing:
                continue
            existing.add(fp)
            idea["fingerprint"] = fp
            new_ideas.append(idea)

        inserted = store_ideas(new_ideas)
        mark_complaints_processed(new_web)

        log_run("pain_miner", "ok", inserted)
        return {
            "report": render_ideas_report(new_ideas),
            "ideas": new_ideas,
            "fetched_web": len(web),
            "new_web": len(new_web),
            "email_opps": len(email_opps),
            "ideas_returned": len(ideas),
            "ideas_inserted": inserted,
        }
    except Exception as e:
        try:
            log_run("pain_miner", "error", 0, str(e)[:500])
        except Exception:
            pass
        raise


if __name__ == "__main__":
    result = asyncio.run(run())
    print("\n=== Pain-Miner output ===\n")
    print(result["report"])
    if "ideas_inserted" in result:
        print(
            f"\n[web raw: {result['fetched_web']}, "
            f"new: {result['new_web']}, email opps: {result['email_opps']}, "
            f"LLM ideas: {result['ideas_returned']}, inserted: {result['ideas_inserted']}]"
        )
