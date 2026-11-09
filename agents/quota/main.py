"""Agent 10 — Quota guard.

Every morning: how many runs Gemini's limits (quota / overload) broke in the last day. Saves a snapshot for the
dashboard (bot_settings.quota) and warns on Telegram, so agents don't fail silently. (GitHub Actions minutes are
free since ai-agents went public, so they're no longer tracked.)

Run: `python -m agents.quota.main`
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta, timezone
from typing import Any

from lib.notify import send_telegram
from lib.supabase_client import log_run, sb

GEMINI_LIMIT = ("429", "quota", "RESOURCE_EXHAUSTED", "Gemini עמוס", "gemini 429", "overloaded")


def _gemini_failures() -> list[str]:
    since = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    rows = sb().table("runs_log").select("agent,error").gte("ran_at", since).not_.is_("error", "null").execute().data or []
    vids = sb().table("knowledge_items").select("id,error").gte("created_at", since).eq("status", "failed").execute().data or []
    hits = [f"{r['agent']}: {r['error'][:80]}" for r in rows if any(k.lower() in r["error"].lower() for k in GEMINI_LIMIT)]
    hits += [f"סיכום #{v['id']}: {v['error'][:80]}" for v in vids if v.get("error") and any(k.lower() in v["error"].lower() for k in GEMINI_LIMIT)]
    return hits


def run() -> dict[str, Any]:
    gemini = _gemini_failures()
    snap = {"gemini_failures": len(gemini), "gemini_examples": gemini[:3], "at": datetime.now(timezone.utc).isoformat()}
    sb().table("bot_settings").upsert({"key": "quota", "value": json.dumps(snap, ensure_ascii=False)}).execute()
    if gemini:
        send_telegram(f"🛡️ שומר מכסות\n\n🤖 Gemini: {len(gemini)} תקלות של מכסה/עומס ב-24 השעות האחרונות.\n" + "\n".join(f"• {g}" for g in gemini[:3]),
                      "jarvis", sections=False)
    log_run("quota", "ok", len(gemini))
    return snap


if __name__ == "__main__":
    try:
        print(run(), file=sys.stderr)
    except Exception as e:
        log_run("quota", "error", 0, str(e)[:500])
        raise
