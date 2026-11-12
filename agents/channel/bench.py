"""Render benchmark: the same seconds of a real channel video with each GL backend, timed.

Run: `python -m agents.channel.bench <channel_video_id> [seconds]` (GL backends from env BENCH_GL, e.g. "swiftshader llvmpipe").
Uses the stored script with even fake timing and no audio, so it needs no TTS and no Gemini.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from lib.supabase_client import sb

ENGINE = Path(__file__).parent / "engine"


def main() -> None:
    vid, secs = int(sys.argv[1]), float(sys.argv[2]) if len(sys.argv) > 2 else 6.0
    row = sb().table("channel_videos").select("lang,title,script").eq("id", vid).single().execute().data
    segs = row["script"]
    timing = [{"a": round(i * 2.6, 3), "b": round(i * 2.6 + 2.4, 3)} for i in range(len(segs))]
    for gl in os.environ.get("BENCH_GL", "swiftshader llvmpipe").split():
        with tempfile.TemporaryDirectory(prefix="bench-") as tmp:
            work = Path(tmp)
            shutil.copytree(ENGINE, work, dirs_exist_ok=True)
            (work / "video.js").write_text("window.VIDEO = " + json.dumps({"segments": segs, "lang": row["lang"] or "he", "title": row["title"],
                                                                           "palette": "indigo", "bpm": 104}, ensure_ascii=False) + ";\n", encoding="utf-8")
            (work / "timing.js").write_text("window.TIMING = " + json.dumps(timing) + ";\n", encoding="utf-8")
            env = {**os.environ, "GL": gl, "NOAUDIO": "1", "SUB": "1", "T0": "0", "T1": str(secs)}
            cmd = [sys.executable, "render.py", "full"]
            if gl == "llvmpipe":
                cmd = ["xvfb-run", "-a", "-s", "-screen 0 1280x1024x24", *cmd]
            t0 = time.monotonic()
            res = subprocess.run(cmd, cwd=work, env=env, capture_output=True, text=True, timeout=1800)
            took = time.monotonic() - t0
            tail = (res.stdout + res.stderr).strip().splitlines()[-3:]
            print(f"[bench] {gl}: {took:.1f}s for {secs:g}s of video (exit {res.returncode}) | {' / '.join(tail)}")


if __name__ == "__main__":
    main()
