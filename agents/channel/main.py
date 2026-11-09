"""Agent 5 — Channel: makes the faceless animated explainer Reels for Inbar's Instagram channel.

Per video: Gemini picks a fresh tech topic and writes a hooked Hebrew script for the 3D hologram engine
(engine/holo.js: which object each line flies to and what happens there) → one Gemini TTS narration →
synthesized beat → deterministic WebGL render (Playwright + ffmpeg) → Supabase Storage + `channel_videos` → the video itself in the marketing
topic on Telegram. Inbar downloads from Telegram or the dashboard and uploads by hand.

Run: `python -m agents.channel.main` (env CHANNEL_EN / CHANNEL_HE, default 3 / 1; AGENT_REQUEST steers the topics)
"""
from __future__ import annotations

import json
import re
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

from agents.channel import beat, critic, voice, writer
from lib.notify import request, send_image_file, send_telegram, send_video
from lib.supabase_client import log_run, sb

ENGINE = Path(__file__).parent / "engine"
PALETTES = ["indigo", "teal", "violet"]   # PALETTES in engine/world.js; videos take turns
BUCKET = "channel-videos"
# The day's videos per channel. Hebrew (one video) goes first so a slow English render can't push it past the job timeout.
PLAN = [("he", int(os.getenv("CHANNEL_HE", "1"))), ("en", int(os.getenv("CHANNEL_EN", "3")))]
STARTED = time.monotonic()
BUDGET = 130 * 60       # the job is killed at 150 min; leave room for setup and the last upload
PER_VIDEO = 25 * 60     # a render + review, measured ~23 min
FLAG = {"en": "🇺🇸", "he": "🇮🇱"}


def _ffmpeg() -> str:
    return shutil.which("ffmpeg") or sys.exit("ffmpeg not found")


def make_video(topic: str, lang: str, palette: str, work: Path, hooks: list[str] | None = None, notes: str | None = None) -> dict[str, Any]:
    script = writer.write_script(topic, lang, hooks, notes)
    shutil.copytree(ENGINE, work, dirs_exist_ok=True)
    segments = [{k: v for k, v in s.items() if k not in ("tone", "say")} for s in script["segments"]]
    (work / "video.js").write_text("window.VIDEO = " + json.dumps({"segments": segments, "lang": lang, "title": script["title"], "palette": palette, "bpm": beat.MOODS[script["mood"]]["bpm"]}, ensure_ascii=False) + ";\n", encoding="utf-8")
    length = voice.narrate(script["segments"], work, lang)
    beat.main(work, script["mood"])
    env = {**os.environ, "SUB": "1", "SCALE": os.getenv("CHANNEL_SCALE", "1")}
    subprocess.run([sys.executable, "render.py", "full"], cwd=work, env=env, check=True, timeout=2400)
    out = work / "upload.mp4"
    subprocess.run([_ffmpeg(), "-v", "error", "-y", "-i", str(work / "out" / "final.mp4"), "-c:v", "libx264", "-crf", "19",
                    "-preset", "medium", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", str(out)],
                   check=True, timeout=900)
    return {**script, "topic": topic, "file": out, "cover": make_cover(work), "seconds": round(length, 1)}


def make_cover(work: Path) -> Path | None:
    """The Reel's cover: a full-size still of the hook shot with the title on it (engine/world.js cover mode).
    Optional: a failed cover must never cost the finished video."""
    try:
        page = (work / "index.html").read_text(encoding="utf-8")
        (work / "cover.html").write_text(page.replace('<script src="world.js">', '<script>window.COVER = true;</script>\n<script src="world.js">'), encoding="utf-8")
        subprocess.run([sys.executable, "render.py", "stills", "1.6"], cwd=work, env={**os.environ, "PAGE": "cover.html"}, check=True, timeout=600)
        out = work / "cover.jpg"
        subprocess.run([_ffmpeg(), "-v", "error", "-y", "-i", str(work / "stills" / "t-01.600.png"), "-q:v", "2", str(out)], check=True, timeout=120)
        return out
    except (subprocess.SubprocessError, OSError) as e:
        print(f"[channel] cover failed: {e}", file=sys.stderr)
        return None


def publish(v: dict[str, Any]) -> int:
    row = sb().table("channel_videos").insert({
        "topic": v["topic"], "lang": v["lang"], "title": v["title"], "caption": v["caption"], "hashtags": v["hashtags"],
        "script": [{"focus": s["focus"], "action": s["action"], "text": s["text"]} for s in v["segments"]], "seconds": v["seconds"], "status": "rendering",
    }).execute().data[0]
    path = f"{row['id']}.mp4"
    sb().storage.from_(BUCKET).upload(path, v["file"].read_bytes(), {"content-type": "video/mp4", "upsert": "true"})
    if v["cover"]:
        sb().storage.from_(BUCKET).upload(f"{row['id']}-cover.jpg", v["cover"].read_bytes(), {"content-type": "image/jpeg", "upsert": "true"})
    sb().table("channel_videos").update({"storage_path": path, "status": "ready"}).eq("id", row["id"]).execute()
    post = f"{v['title']}\n\n{v['caption']}\n\n{' '.join(v['hashtags'])}"
    checked = f"\n\n🔎 נבדק מול: {', '.join(v['sources'])}" if v.get("sources") else "\n\n⚠️ בלי מחקר (החיפוש נכשל)"
    flag = FLAG[v["lang"]]
    send_video(v["file"], f"{flag} 🎬 #{row['id']} {post}{checked}\n\n{critic.summary(v.get('review'))}"[:1024], "marketing")
    if v["cover"]:
        send_image_file(v["cover"], f"{flag} 🖼️ קאבר לסרטון #{row['id']}", "marketing")
    send_telegram(f"{flag} 📋 כיתוב לסרטון #{row['id']}\n\n{post}", "marketing")   # its own message, so it copies in one tap
    return row["id"]


def queued_ideas(lang: str) -> list[dict[str, Any]]:
    """Ideas Inbar handed to the agent in the dashboard's idea lab, oldest first, in this channel's language."""
    rows = sb().table("video_ideas").select("id,idea,hooks").eq("target", "agent").eq("status", "queued").order("created_at").execute().data or []
    return [r for r in rows if bool(re.search("[\u0590-\u05FF]", r["idea"])) == (lang == "he")]


def _build(topic: str, lang: str, palette: str, hooks: list[str] | None, notes: str | None) -> dict[str, Any]:
    work = Path(tempfile.mkdtemp(prefix="channel-"))
    try:
        v = make_video(topic, lang, palette, work, hooks, notes)
    except BaseException:
        shutil.rmtree(work, ignore_errors=True)
        raise
    return {**v, "work": work, "review": critic.review(v["file"], v, lang)}


def reviewed(topic: str, lang: str, palette: str, hooks: list[str] | None, left: int, inbars: bool = False) -> dict[str, Any] | None:
    """Make the video and let the critic watch it. Weak: remake it once on the SAME idea with the critic's notes, if the time
    budget still covers the remake and every video after it. Return the better version, or None if both are weak —
    except Inbar's own ideas (`inbars`), which are never dropped: they always go out in their best version."""
    first = _build(topic, lang, palette, hooks, None)
    r = first["review"]
    if not r or r["score"] >= critic.BAR:
        return first
    has_time = time.monotonic() - STARTED + PER_VIDEO * (left + 1) < BUDGET
    if not has_time:
        print(f"[channel] {topic}: score {r['score']}, no time for a remake", file=sys.stderr)
        return first if r["score"] >= (0 if inbars else critic.FLOOR) else _drop(first)
    notes = r["fix"] + ("\nProblems seen: " + "; ".join(r["problems"]) if r["problems"] else "")
    try:
        second = _build(topic, lang, palette, hooks, notes)
    except Exception as e:  # noqa: BLE001 — a failed remake falls back to the first version
        print(f"[channel] {topic}: remake failed: {e}", file=sys.stderr)
        return first if r["score"] >= (0 if inbars else critic.FLOOR) else _drop(first)
    s2 = second["review"]["score"] if second["review"] else critic.BAR
    best, other = (second, first) if s2 >= r["score"] else (first, second)
    shutil.rmtree(other["work"], ignore_errors=True)
    best_score = best["review"]["score"] if best["review"] else critic.BAR
    return best if best_score >= (0 if inbars else critic.FLOOR) else _drop(best)


def _drop(v: dict[str, Any]) -> None:
    shutil.rmtree(v["work"], ignore_errors=True)
    return None


def run() -> dict[str, Any]:
    rows = sb().table("channel_videos").select("topic,lang").order("created_at").execute().data or []
    made, failed, n = [], [], 0
    total = sum(c for _, c in PLAN if c > 0)
    for lang, count in PLAN:
        if count <= 0:
            continue
        done = [r["topic"] for r in rows if (r.get("lang") or "he") == lang]
        queue = queued_ideas(lang)[:count]
        from_queue = {q["idea"]: q["id"] for q in queue}
        queue_hooks = {q["idea"]: q.get("hooks") or [] for q in queue}
        try:
            topics = list(from_queue) + (writer.pick_topics(min(count - len(queue), 6), done, request(), lang) if count > len(queue) else [])
        except Exception as e:  # noqa: BLE001
            failed.append(f"{FLAG[lang]} topics: {str(e)[:200]}")
            topics = list(from_queue)
        for topic in topics:
            try:
                left = total - n - 1   # videos still to make after this one
                video = reviewed(topic, lang, PALETTES[(len(rows) + n) % len(PALETTES)], queue_hooks.get(topic), left, topic in from_queue)
                if video is None:
                    failed.append(f"{FLAG[lang]} {topic}: המבקר פסל גם אחרי תיקון")
                    n += 1
                    continue
                made.append(publish(video))
                shutil.rmtree(video["work"], ignore_errors=True)
                if topic in from_queue:
                    sb().table("video_ideas").update({"status": "used"}).eq("id", from_queue[topic]).execute()
            except voice.QuotaExhausted as e:
                failed.append(f"{FLAG[lang]} {topic}: {e}")
                break
            except Exception as e:  # noqa: BLE001 — one bad video must not stop the rest
                failed.append(f"{FLAG[lang]} {topic}: {str(e)[:200]}")
                print(f"[channel] {topic} failed: {e}", file=sys.stderr)
            n += 1
            time.sleep(5)
    summary = f"🎬 נוצרו {len(made)} סרטונים (קודם 🇮🇱 ואז 🇺🇸). הם בדשבורד ובהודעות כאן, מוכנים להורדה."
    if failed:
        summary += "\n\n⚠️ לא נוצרו:\n" + "\n".join(f"- {f}" for f in failed)
    send_telegram(summary, "marketing")
    log_run("channel", "ok" if made and not failed else "error" if not made else "partial", len(made), "; ".join(failed)[:500] or None)
    return {"made": made, "failed": failed}


if __name__ == "__main__":
    print(run(), file=sys.stderr)
