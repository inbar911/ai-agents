"""One row in ai_calls per Gemini / Groq request, for the dashboard's AI usage meter. Never fails the caller."""
from __future__ import annotations

import os
import sys
from typing import Any


def track(provider: str, model: str, status: int, tokens: int | None = None) -> None:
    try:
        from lib.supabase_client import sb
        sb().table("ai_calls").insert({
            "source": os.getenv("GITHUB_WORKFLOW") or "local", "provider": provider, "model": model[:60], "status": status, "tokens": tokens,
        }).execute()
    except Exception as e:  # noqa: BLE001 — counting must never cost a run
        print(f"[usage] not tracked: {e}", file=sys.stderr)


def gemini_tokens(data: Any) -> int | None:
    """totalTokenCount from a Gemini generateContent response, when there is one."""
    try:
        return int(data["usageMetadata"]["totalTokenCount"])
    except (KeyError, TypeError, ValueError):
        return None
