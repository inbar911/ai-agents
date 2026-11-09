"""Who Inbar is, for the agents' prompts. Kept in Supabase (bot_settings.profile), not in this public repo."""
from __future__ import annotations

import json
from functools import cache
from typing import Any

from lib.supabase_client import sb

FALLBACK = {"who": "a solo app builder", "student": "a high-school student", "majors": []}


@cache
def profile() -> dict[str, Any]:
    try:
        rows = sb().table("bot_settings").select("value").eq("key", "profile").execute().data
        return {**FALLBACK, **json.loads(rows[0]["value"])} if rows else FALLBACK
    except Exception:  # noqa: BLE001 — a missing profile only makes the prompts less personal
        return FALLBACK


def who() -> str:
    return profile()["who"]
