"""Agent 1 — Gatekeeper.

Reads last 24h of Gmail via Zapier MCP (1 task per run), classifies each new
email with Groq, stores opportunity flags in Supabase, returns a markdown
summary. Does NOT send the email itself — Orchestrator (Agent 4) ships the
combined daily brief to save Zapier tasks.

Run: `python -m agents.gatekeeper.main`
"""
from __future__ import annotations

import asyncio
import sys
from typing import Any

from lib.llm import classify_emails
from lib.mailer import fetch_recent_emails
from lib.supabase_client import log_run, sb

LOOKBACK_HOURS = 24
MAX_EMAILS = 50


def is_processed(message_id: str) -> bool:
    res = (
        sb()
        .table("processed_emails")
        .select("gmail_message_id")
        .eq("gmail_message_id", message_id)
        .limit(1)
        .execute()
    )
    return bool(res.data)


def mark_processed(message_id: str) -> None:
    sb().table("processed_emails").upsert(
        {"gmail_message_id": message_id}, on_conflict="gmail_message_id"
    ).execute()


def store_opportunity(email: dict[str, Any], cls: dict[str, Any]) -> None:
    sb().table("opportunities").insert(
        {
            "gmail_message_id": email["id"],
            "from_addr": (email.get("from") or "")[:200],
            "subject": (email.get("subject") or "")[:300],
            "complaint": (cls.get("complaint") or "")[:1000],
            "domain": (cls.get("domain") or "")[:100],
        }
    ).execute()


def render_summary(
    classified: list[dict[str, Any]], emails_by_id: dict[str, dict[str, Any]]
) -> str:
    important = [c for c in classified if c["tag"] == "important"]
    opportunities = [c for c in classified if c["tag"] == "opportunity"]

    lines: list[str] = ["## 📧 מיילים", ""]

    if opportunities:
        lines.append(f"## הזדמנויות ({len(opportunities)})")
        for o in opportunities:
            email = emails_by_id.get(o["id"], {})
            sender = email.get("from", "?")
            lines.append(f"- **{sender}** — {o['summary']}")
            if o.get("complaint"):
                lines.append(f"  - תלונה: {o['complaint']}")
            if o.get("domain"):
                lines.append(f"  - דומיין: `{o['domain']}`")
        lines.append("")

    if important:
        lines.append(f"## חשוב ({len(important)})")
        for i in important:
            email = emails_by_id.get(i["id"], {})
            sender = email.get("from", "?")
            subj = email.get("subject", "")
            lines.append(f"- **{sender}** | {subj} — {i['summary']}")
        lines.append("")

    if not important and not opportunities:
        lines.append("_אין מיילים חשובים ב-24 שעות האחרונות._")

    return "\n".join(lines)


async def run() -> dict[str, Any]:
    try:
        emails = await asyncio.to_thread(
            fetch_recent_emails, LOOKBACK_HOURS, MAX_EMAILS
        )
        print(f"[gatekeeper] fetched {len(emails)} emails", file=sys.stderr)

        new_emails = [e for e in emails if not is_processed(e["id"])]
        print(f"[gatekeeper] {len(new_emails)} new (after dedup)", file=sys.stderr)

        if not new_emails:
            log_run("gatekeeper", "ok", 0)
            return {
                "summary": "_אין מיילים חדשים ב-24 שעות האחרונות._",
                "email_count": 0,
                "opportunity_count": 0,
            }

        classified = classify_emails(new_emails)
        emails_by_id = {e["id"]: e for e in new_emails}

        for e in new_emails:
            mark_processed(e["id"])

        opp_count = 0
        for c in classified:
            email = emails_by_id.get(c["id"])
            if not email:
                continue
            if c["tag"] == "opportunity" and c.get("complaint"):
                store_opportunity(email, c)
                opp_count += 1

        summary = render_summary(classified, emails_by_id)
        log_run("gatekeeper", "ok", len(new_emails))
        return {
            "summary": summary,
            "email_count": len(new_emails),
            "opportunity_count": opp_count,
        }
    except Exception as e:
        try:
            log_run("gatekeeper", "error", 0, str(e)[:500])
        except Exception:
            pass
        raise


if __name__ == "__main__":
    result = asyncio.run(run())
    # the summary (built from Inbar's email) stays out of the public run log
    print(
        f"\n[emails: {result['email_count']}, opportunities: {result['opportunity_count']}]"
    )
