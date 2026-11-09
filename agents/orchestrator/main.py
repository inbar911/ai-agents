"""Agent 4 — Orchestrator.

Central router. Three modes:
- daily   : runs Gatekeeper + Scout, composes ONE combined brief, sends by email + Telegram.
- ideas   : runs Pain-Miner and delivers the new Micro-SaaS ideas.
- weekend : runs Pain-Miner, reviews ideas against AI trends (from Scout's DB),
            adds finance snapshot + a curated long-form YouTube pick,
            sends ONE combined weekend report.
- report  : Saturday-only consolidation. Does NOT run sub-agents (they ran
            earlier in the day via separate sat-* workflows). Reads from DB,
            adds finance + youtube, sends the consolidated weekend email.

Run:
  python -m agents.orchestrator.main          # daily
  python -m agents.orchestrator.main ideas    # daily opportunities
  python -m agents.orchestrator.main weekend  # weekend
  python -m agents.orchestrator.main report   # report-only
"""
from __future__ import annotations

import asyncio
import html as html_module
import sys
from datetime import datetime, timezone
from typing import Any

from agents.gatekeeper.main import run as gatekeeper_run
from agents.pain_miner.main import run as pain_miner_run
from agents.scout.main import run as scout_run
from lib.llm import ask_json, review_ideas
from lib.notify import notify, request
from lib.profile import who
from lib.memory import guidance
from lib.scrapers.finance import fetch_all_quotes
from lib.scrapers.youtube import pick_long_form
from lib.supabase_client import log_run, sb


def _now_local_label() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def fetch_top_ai_updates(limit: int = 20) -> list[dict[str, Any]]:
    res = (
        sb()
        .table("ai_updates")
        .select("source,title,url,score,captured_at")
        .order("captured_at", desc=True)
        .limit(limit)
        .execute()
    )
    return res.data or []


def fetch_recent_ideas(limit: int = 5) -> list[dict[str, Any]]:
    res = (
        sb()
        .table("ideas_history")
        .select("*")
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return res.data or []


def _md_to_html(md: str) -> str:
    out_lines: list[str] = []
    for line in md.splitlines():
        if not line.strip():
            out_lines.append("<br>")
            continue
        if line.startswith("### "):
            out_lines.append(f"<h3>{html_module.escape(line[4:])}</h3>")
        elif line.startswith("## "):
            out_lines.append(f"<h2>{html_module.escape(line[3:])}</h2>")
        elif line.startswith("# "):
            out_lines.append(f"<h1>{html_module.escape(line[2:])}</h1>")
        elif line.startswith("- "):
            out_lines.append(f"<li>{html_module.escape(line[2:])}</li>")
        elif line.startswith("---"):
            out_lines.append("<hr>")
        else:
            out_lines.append(f"<p>{html_module.escape(line)}</p>")
    return (
        "<html><body style='font-family:-apple-system,Segoe UI,Roboto,sans-serif;"
        "max-width:720px;margin:0 auto;padding:16px;line-height:1.5'>"
        + "\n".join(out_lines)
        + "</body></html>"
    )


async def daily_run() -> dict[str, Any]:
    gk_task = gatekeeper_run()
    sc_task = scout_run()
    gk_result, sc_result = await asyncio.gather(
        gk_task, sc_task, return_exceptions=True
    )

    gk_md = (
        gk_result["summary"]
        if isinstance(gk_result, dict)
        else f"_Gatekeeper failed: {gk_result}_"
    )
    sc_md = (
        sc_result["digest"]
        if isinstance(sc_result, dict)
        else f"_Scout failed: {sc_result}_"
    )

    label = _now_local_label()
    subject = f"📬 מיילים + חדשות AI — {label}"
    body_md = (
        f"# 📬 מיילים + חדשות AI — {label}\n\n"
        f"{gk_md}\n\n---\n\n"
        f"{sc_md}\n"
    )
    body_html = _md_to_html(body_md)
    notify(subject, body_md, body_html, bot="mail", sections=False, agent="mail")   # one Telegram message a day, not one per section
    log_run("orchestrator", "ok_daily", 1)
    print("[orchestrator] daily brief sent", file=sys.stderr)
    return {"mode": "daily", "sent": True}


def render_weekend_report(
    reviews: list[dict[str, Any]],
    quotes: list[dict[str, Any]],
    video: dict[str, Any] | None,
    ideas_count: int,
    pain_miner_meta: dict[str, Any],
) -> str:
    label = _now_local_label()
    lines: list[str] = [f"# Weekend report — {label}", ""]

    lines.append(f"## 5 רעיונות אחרונים — ביקורת מול מגמות AI")
    if not reviews:
        lines.append("_אין רעיונות בסיס לביקורת._")
    else:
        for r in reviews:
            verdict = r.get("verdict", "pivot")
            mark = "APPROVE" if verdict == "approve" else (
                "REJECT" if verdict == "reject" else "PIVOT"
            )
            lines.append(f"### [{mark}] {r.get('title','')}")
            lines.append(r.get("reason", ""))
            lines.append("")

    lines.append("## שוק")
    if not quotes:
        lines.append("_שווקים לא הצלחנו לקבל (Yahoo רייט-לימיט?)._")
    else:
        for q in quotes:
            sign = "+" if q["change"] >= 0 else ""
            week_sign = "+" if q["week_change"] >= 0 else ""
            lines.append(
                f"- **{q.get('display_name', q['name'])}** ({q['symbol']}): "
                f"{q['latest']:.2f} {q['currency']} | "
                f"יום: {sign}{q['change']:.2f} ({sign}{q['change_pct']:.2f}%) | "
                f"שבוע: {week_sign}{q['week_change_pct']:.2f}%"
            )
    lines.append("")

    lines.append("## לסוף שבוע")
    if not video:
        lines.append("_לא נמצא סרטון מתאים בערוצים המסומנים._")
    else:
        lines.append(
            f"- **[{video.get('category','?')}] {video.get('channel','')}**: "
            f"[{video.get('title','')}]({video.get('url','')})"
        )
    lines.append("")

    lines.append("## נתונים")
    lines.append(
        f"- Pain-Miner: feed={pain_miner_meta.get('fetched_web', 0)}, "
        f"new={pain_miner_meta.get('new_web', 0)}, "
        f"emailOpps={pain_miner_meta.get('email_opps', 0)}, "
        f"inserted={pain_miner_meta.get('ideas_inserted', 0)}"
    )
    lines.append(f"- Ideas reviewed: {ideas_count}")
    return "\n".join(lines).rstrip()


async def weekend_run() -> dict[str, Any]:
    pm_result = await pain_miner_run()
    ideas = fetch_recent_ideas(limit=5)
    ai_trends = fetch_top_ai_updates(limit=20)

    reviews: list[dict[str, Any]] = []
    if ideas:
        try:
            reviews = review_ideas(ideas, ai_trends)
            print(f"[orchestrator] reviewed {len(reviews)} ideas", file=sys.stderr)
        except Exception as e:
            print(f"[orchestrator] review_ideas failed: {e}", file=sys.stderr)

    quotes = fetch_all_quotes()
    print(f"[orchestrator] fetched {len(quotes)} quotes", file=sys.stderr)

    video = pick_long_form()
    print(
        f"[orchestrator] video pick: {video['title'] if video else 'NONE'}",
        file=sys.stderr,
    )

    pm_meta = pm_result if isinstance(pm_result, dict) else {}
    body_md = render_weekend_report(reviews, quotes, video, len(ideas), pm_meta)
    label = _now_local_label()
    subject = f"Weekend report — {label}"
    body_html = _md_to_html(body_md)
    notify(subject, body_md, body_html, bot="ideas", agent="ideas")
    log_run("orchestrator", "ok_weekend", 1)
    print("[orchestrator] weekend report sent", file=sys.stderr)
    return {"mode": "weekend", "sent": True, "reviews": len(reviews)}


async def report_run() -> dict[str, Any]:
    """Saturday consolidation. Does NOT trigger sub-agents — they already ran
    earlier via sat-cipher / sat-pulse / sat-forge workflows. Reads from DB,
    adds finance + youtube, sends the consolidated weekend email.
    """
    ideas = fetch_recent_ideas(limit=5)
    ai_trends = fetch_top_ai_updates(limit=20)

    reviews: list[dict[str, Any]] = []
    if ideas:
        try:
            reviews = review_ideas(ideas, ai_trends)
            print(f"[orchestrator] reviewed {len(reviews)} ideas", file=sys.stderr)
        except Exception as e:
            print(f"[orchestrator] review_ideas failed: {e}", file=sys.stderr)

    quotes = fetch_all_quotes()
    print(f"[orchestrator] fetched {len(quotes)} quotes", file=sys.stderr)

    video = pick_long_form()
    print(
        f"[orchestrator] video pick: {video['title'] if video else 'NONE'}",
        file=sys.stderr,
    )

    body_md = render_weekend_report(reviews, quotes, video, len(ideas), {})
    label = _now_local_label()
    subject = f"Weekend report — {label}"
    body_html = _md_to_html(body_md)
    notify(subject, body_md, body_html, bot="ideas", agent="ideas")
    log_run("orchestrator", "ok_report", 1)
    print("[orchestrator] consolidated weekend report sent", file=sys.stderr)
    return {"mode": "report", "sent": True, "reviews": len(reviews)}


async def ideas_run() -> dict[str, Any]:
    """Daily opportunities: mine fresh complaints into Micro-SaaS ideas and deliver them.

    When JARVIS dispatched this with a request ("ideas around fitness apps"), skip the
    complaint mining and brainstorm 5 ideas on that request instead.
    """
    if request():
        return await _requested_ideas(request())
    result = await pain_miner_run()
    if not result.get("ideas"):
        log_run("orchestrator", "ok_ideas", 0)
        return {"mode": "ideas", "sent": False}
    label = _now_local_label()
    subject = f"💡 הזדמנויות Micro-SaaS — {label}"
    notify(subject, result["report"], _md_to_html(result["report"]), bot="ideas", agent="ideas")
    log_run("orchestrator", "ok_ideas", len(result["ideas"]))
    return {"mode": "ideas", "sent": True, "ideas": len(result["ideas"])}


REQUEST_IDEAS_SYSTEM = """Inbar ({who}; Next.js + Supabase + Vercel, free tiers) asked for Micro-SaaS ideas
around a specific theme. Give 5 concrete, buildable ideas. Hebrew. Return JSON only:
{"ideas":[{"title":"...","problem":"...","target_user":"...","solution":"..."}]}"""


async def _requested_ideas(req: str) -> dict[str, Any]:
    out = ask_json(REQUEST_IDEAS_SYSTEM.replace("{who}", who()) + guidance("ideas"), {"request": req}, max_tokens=4000, temperature=0.8)
    ideas = [i for i in out.get("ideas", []) if isinstance(i, dict) and isinstance(i.get("title"), str)][:5]
    lines = [f"# 💡 5 רעיונות לפי הבקשה: {req}", ""]
    for n, i in enumerate(ideas, 1):
        lines += [f"## {n}. {i['title']}", f"בעיה: {i.get('problem', '')}", f"למי: {i.get('target_user', '')}", f"פתרון: {i.get('solution', '')}", ""]
    report = "\n".join(lines).rstrip()
    notify(f"💡 הזדמנויות — {req[:60]}", report, _md_to_html(report), bot="ideas", agent="ideas")
    log_run("orchestrator", "ok_ideas_request", len(ideas))
    return {"mode": "ideas", "sent": True, "ideas": len(ideas)}


async def main_async(mode: str) -> dict[str, Any]:
    try:
        if mode == "ideas":
            return await ideas_run()
        if mode == "weekend":
            return await weekend_run()
        if mode == "report":
            return await report_run()
        return await daily_run()
    except Exception as e:
        try:
            log_run("orchestrator", "error", 0, str(e)[:500])
        except Exception:
            pass
        raise


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "daily"
    if mode not in ("daily", "ideas", "weekend", "report"):
        print(f"Unknown mode: {mode}. Use 'daily', 'ideas', 'weekend', or 'report'.", file=sys.stderr)
        sys.exit(2)
    result = asyncio.run(main_async(mode))
    print(f"\n=== Orchestrator done ({result['mode']}) ===")
