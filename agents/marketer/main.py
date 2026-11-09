"""Agent 5 — Marketer.

Inbar builds well but doesn't market. Every day this agent picks one product
(in rotation), writes 3 short-form video ideas for it — hook, full script and
caption — for a faceless TikTok/Reels account, stores them (so later days
don't repeat), and delivers them by email + Telegram.

Run: `python -m agents.marketer.main`
"""
from __future__ import annotations

import sys
from datetime import date
from typing import Any

from agents.marketer.products import PRODUCTS
from lib.llm import ask_json
from lib.memory import guidance
from lib.notify import notify, request, send_telegram
from lib.supabase_client import log_run, sb

SYSTEM = """You are a short-form video strategist for a solo Israeli maker who posts on a FACELESS
TikTok / Instagram Reels account (screen recordings, text on screen, b-roll, voice-over — never his face).

Write exactly 3 different video ideas for the product you are given. Each idea:
- hook: the first 1-2 seconds, on-screen text, max 12 words, makes an Israeli viewer stop scrolling
- script: 20-40 second script as numbered beats ("1. ...", "2. ..."), each beat = what's on screen + the line said/shown
- caption: post caption with 3-5 relevant hashtags
- platform: "tiktok" or "reels"
Mix formats across the 3 (e.g. problem→solution demo, myth vs truth, POV, before/after, quick tutorial).
Everything in natural spoken Hebrew; product/tool names may stay in English.
Do NOT repeat or paraphrase any hook from avoid_hooks.
If a request from Inbar is given, follow it (angle, format, audience) — it overrides the defaults above.

Output STRICT JSON: {"ideas":[{"platform":"...","hook":"...","script":"...","caption":"..."}, ...]}"""


def _today_product() -> dict[str, str]:
    return PRODUCTS[date.today().toordinal() % len(PRODUCTS)]


def _recent_hooks(product: str, limit: int = 30) -> list[str]:
    res = sb().table("content_ideas").select("hook").eq("product", product).order("created_at", desc=True).limit(limit).execute()
    return [r["hook"] for r in (res.data or [])]


def _generate(product: dict[str, str], avoid: list[str]) -> list[dict[str, str]]:
    out = ask_json(SYSTEM + guidance("marketer"), {"product": product, "avoid_hooks": avoid, "request": request() or None}, max_tokens=5000, temperature=0.8)
    ideas = out.get("ideas")
    out: list[dict[str, str]] = []
    for i in ideas if isinstance(ideas, list) else []:
        if not isinstance(i, dict):
            continue
        hook, script = str(i.get("hook") or "").strip(), str(i.get("script") or "").strip()
        if not hook or not script:
            continue
        platform = "reels" if str(i.get("platform")).lower() == "reels" else "tiktok"
        out.append({"platform": platform, "hook": hook[:200], "script": script[:3000], "caption": str(i.get("caption") or "").strip()[:600]})
    return out[:3]


def _render(product: dict[str, str], ideas: list[dict[str, str]]) -> str:
    lines = [f"# 🎥 3 רעיונות לתוכן — {product['name']}", f"קהל: {product['audience']}", ""]
    for n, idea in enumerate(ideas, start=1):
        lines += [
            "---",
            f"## {n}. {idea['hook']}",
            f"פלטפורמה: {'טיקטוק' if idea['platform'] == 'tiktok' else 'רילס'}",
            "",
            idea["script"],
            "",
            f"כיתוב: {idea['caption']}",
            "",
        ]
    return "\n".join(lines).rstrip()


def run() -> dict[str, Any]:
    product = _today_product()
    try:
        ideas = _generate(product, _recent_hooks(product["name"]))
        if not ideas:
            raise RuntimeError("model returned no usable ideas")
        sb().table("content_ideas").insert([{**i, "product": product["name"]} for i in ideas]).execute()
        report = _render(product, ideas)
        notify(f"🎥 שיווק — {product['name']} — {date.today():%d/%m}", report, bot="marketing", agent="marketer")
        log_run("marketer", "ok", len(ideas))
        return {"product": product["name"], "ideas": len(ideas), "report": report}
    except Exception as e:
        try:
            log_run("marketer", "error", 0, str(e)[:500])
            send_telegram(f"⚠️ לא הצלחתי להכין רעיונות לשיווק הפעם ({str(e)[:120]}). נסה שוב עוד רגע.", "marketing")
        except Exception:
            pass
        raise


if __name__ == "__main__":
    result = run()
    print(result["report"], file=sys.stderr)
