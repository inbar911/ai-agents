"""Read-side helpers over the JARVIS Telegram bot's tables (same Supabase project)."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

import httpx
import icalendar
import recurring_ical_events

from lib.supabase_client import sb

IL = ZoneInfo("Asia/Jerusalem")


def il_today() -> date:
    return datetime.now(IL).date()


def _il(iso: str) -> datetime:
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(IL)


def bot_secret(name: str) -> str | None:
    return sb().rpc("get_bot_secret", {"secret_name": name}).execute().data or None


def open_tasks() -> list[dict[str, Any]]:
    rows = sb().table("bot_tasks").select("id,text,remind_at").eq("done", False).order("remind_at", nullsfirst=False).execute().data or []
    return [{"id": r["id"], "text": r["text"], "due": _il(r["remind_at"]).strftime("%d/%m %H:%M") if r["remind_at"] else None} for r in rows]


def free_windows(day: date) -> list[str]:
    rows = sb().table("free_slots").select("starts_at,ends_at").order("starts_at").execute().data or []
    return [f"{_il(r['starts_at']):%H:%M}–{_il(r['ends_at']):%H:%M}" for r in rows if _il(r["starts_at"]).date() == day]


def calendar_events(day: date) -> list[str] | None:
    """Timed events for `day` from the secret iCal feed(s); None when no feed is connected."""
    feeds = [u.strip() for u in (bot_secret("ical_urls") or "").split(",") if u.strip()]
    if not feeds:
        return None
    start = datetime.combine(day, datetime.min.time(), IL)
    events: list[tuple[datetime, str]] = []
    with httpx.Client(timeout=20) as client:
        for url in feeds:
            cal = icalendar.Calendar.from_ical(client.get(url).raise_for_status().content)
            for ev in recurring_ical_events.of(cal).between(start, start + timedelta(days=1)):
                begin = ev.get("DTSTART").dt
                if not isinstance(begin, datetime):
                    continue  # all-day
                events.append((begin.astimezone(IL), str(ev.get("SUMMARY") or "(ללא שם)")))
    return [f"{t:%H:%M} {title}" for t, title in sorted(events)]


def week_stats() -> dict[str, Any]:
    since = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    q = lambda table, cols, col: sb().table(table).select(cols).gte(col, since).execute().data or []  # noqa: E731
    tasks = q("bot_tasks", "text,done", "created_at")
    meals = q("food_log", "kcal,eaten_at", "eaten_at")
    workouts = q("activity_log", "activity,minutes,kcal", "done_at")
    videos = q("knowledge_items", "title,status", "created_at")
    packs = q("prompt_projects", "name", "created_at")
    agent_runs = q("runs_log", "agent,status,error", "ran_at")
    days = len({_il(m["eaten_at"]).date() for m in meals})
    return {
        "tasks": {"created": len(tasks), "done": sum(t["done"] for t in tasks), "open": [t["text"] for t in tasks if not t["done"]]},
        "nutrition": {
            "days_logged": days,
            "avg_kcal_per_logged_day": round(sum(m["kcal"] for m in meals) / days) if days else 0,
            "workouts": [f"{w['activity']} −{w['kcal']}" for w in workouts],
        },
        "videos": [v["title"] for v in videos if v["status"] == "done"],
        "prompt_packs": [p["name"] for p in packs],
        "agent_runs": len(agent_runs),
        "agent_failures": sorted({r["agent"] for r in agent_runs if r["error"] or str(r["status"]).startswith("error")}),
    }
