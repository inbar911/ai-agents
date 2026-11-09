"""Agent 10 — Quota guard.

Every morning: GitHub Actions minutes used this month by ai-agents (private repo, 2,000 free minutes a month;
each job is billed rounded up to the minute) with a month-end forecast, and how many runs Gemini's limits broke
in the last day. Saves a snapshot for the dashboard (bot_settings.quota) and warns on Telegram before agents
start failing silently.

Run: `python -m agents.quota.main` (needs GITHUB_TOKEN with actions:read and GITHUB_REPOSITORY, both set by Actions)
"""
from __future__ import annotations

import calendar
import json
import math
import os
import sys
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from lib.bot_data import il_today
from lib.notify import send_telegram
from lib.supabase_client import log_run, sb

FREE_MINUTES = 2000
WARN_AT = 0.8   # warn when the month-end forecast passes 80% of the free minutes
GEMINI_LIMIT = ("429", "quota", "RESOURCE_EXHAUSTED", "Gemini עמוס", "gemini 429", "overloaded")


def _minutes(month_start: datetime) -> int:
    token, repo = os.environ["GITHUB_TOKEN"], os.environ["GITHUB_REPOSITORY"]
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"}
    total = 0
    with httpx.Client(timeout=30, headers=headers) as gh:
        page = 1
        while True:
            runs = gh.get(f"https://api.github.com/repos/{repo}/actions/runs",
                          params={"created": f">={month_start:%Y-%m-%d}", "per_page": 100, "page": page}).raise_for_status().json()["workflow_runs"]
            for run in runs:
                jobs = gh.get(run["jobs_url"], params={"per_page": 100}).raise_for_status().json()["jobs"]
                for job in jobs:
                    if job.get("started_at") and job.get("completed_at"):
                        secs = (datetime.fromisoformat(job["completed_at"].replace("Z", "+00:00"))
                                - datetime.fromisoformat(job["started_at"].replace("Z", "+00:00"))).total_seconds()
                        total += max(1, math.ceil(secs / 60))
            if len(runs) < 100:
                return total
            page += 1


def _gemini_failures() -> list[str]:
    since = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    rows = sb().table("runs_log").select("agent,error").gte("ran_at", since).not_.is_("error", "null").execute().data or []
    vids = sb().table("knowledge_items").select("id,error").gte("created_at", since).eq("status", "failed").execute().data or []
    hits = [f"{r['agent']}: {r['error'][:80]}" for r in rows if any(k.lower() in r["error"].lower() for k in GEMINI_LIMIT)]
    hits += [f"סיכום #{v['id']}: {v['error'][:80]}" for v in vids if v.get("error") and any(k.lower() in v["error"].lower() for k in GEMINI_LIMIT)]
    return hits


def run() -> dict[str, Any]:
    today = il_today()
    month_start = datetime(today.year, today.month, 1, tzinfo=timezone.utc)
    used = _minutes(month_start)
    days_in_month = calendar.monthrange(today.year, today.month)[1]
    forecast = round(used / today.day * days_in_month)
    gemini = _gemini_failures()
    snap = {"month": f"{today:%Y-%m}", "used": used, "forecast": forecast, "limit": FREE_MINUTES,
            "gemini_failures": len(gemini), "gemini_examples": gemini[:3], "at": datetime.now(timezone.utc).isoformat()}
    sb().table("bot_settings").upsert({"key": "quota", "value": json.dumps(snap, ensure_ascii=False)}).execute()

    warn = []
    # the forecast is noise in the month's first days; the raw count still warns
    if (today.day >= 3 and forecast >= FREE_MINUTES * WARN_AT) or used >= FREE_MINUTES * WARN_AT:
        over = "יעבור" if forecast > FREE_MINUTES else "יתקרב ל"
        warn.append(f"⏱️ GitHub: {used} מתוך {FREE_MINUTES} דקות החודש. בקצב הזה {over}-{FREE_MINUTES} עד סוף החודש (~{forecast}). "
                    f"כשזה נגמר, כל הסוכנים נעצרים עד ה-1 לחודש. אפשר להוריד סרטונים בערוץ או להעביר ריצות.")
    if gemini:
        warn.append(f"🤖 Gemini: {len(gemini)} תקלות של מכסה/עומס ב-24 השעות האחרונות.\n" + "\n".join(f"• {g}" for g in gemini[:3]))
    if warn:
        send_telegram("🛡️ שומר מכסות\n\n" + "\n\n".join(warn), "jarvis", sections=False)
    log_run("quota", "ok", used)
    return snap


if __name__ == "__main__":
    try:
        print(run(), file=sys.stderr)
    except Exception as e:
        log_run("quota", "error", 0, str(e)[:500])
        raise
