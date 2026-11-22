"""Board style video (18.11, Inbar's new channel look): a 3D study room, Noa asks, Claude answers and writes on a live
whiteboard with his pointer. script.py writes the dialogue + board, voice.py voices it, this file renders and mixes.

The page (board/page/) is ES modules, so it is served over a local HTTP server, rendered frame by frame with Playwright
(seek = window.render(t)) and piped into ffmpeg. The cloud runner has no GPU, so by default the page renders the
"light" look (no depth-of-field/AO pass, no supersampling, ~1 s a frame): Inbar's choice, 18.11.
Env: BOARD_FULL=1 the full look (needs a GPU), BOARD_GPU=1 use the local GPU, BOARD_FPS (default 24)."""
from __future__ import annotations

import functools
import json
import os
import shutil
import subprocess
import sys
import threading
import time
import wave
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import numpy as np

from agents.channel import beat
from agents.channel.board import script as board_script, voice as board_voice

PAGE = Path(__file__).parent / "page"
SR = 48000
FF = shutil.which("ffmpeg") or "ffmpeg"


class _Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *a: Any) -> None:
        pass


def _serve(root: Path) -> tuple[ThreadingHTTPServer, int]:
    srv = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(_Quiet, directory=str(root)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, srv.server_address[1]


def _open(p: Any, url: str) -> tuple[Any, Any]:
    if os.environ.get("BOARD_GPU"):
        gl = ["--enable-gpu", "--ignore-gpu-blocklist"]
    elif os.environ.get("GL") == "llvmpipe":
        gl = ["--use-angle=gl", "--ignore-gpu-blocklist"]
    else:
        gl = ["--enable-unsafe-swiftshader"]
    b = p.chromium.launch(args=["--force-color-profile=srgb", "--disable-lcd-text", "--font-render-hinting=none", *gl])
    pg = b.new_page(viewport={"width": 1080, "height": 1920}, device_scale_factor=1)
    errors: list[str] = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(url)
    try:
        pg.wait_for_function("window.READY === true", timeout=180_000)
    except Exception as e:  # noqa: BLE001
        raise RuntimeError(f"board page did not load: {errors or e}")
    pg.errors = errors
    return b, pg


def render(work: Path, out: Path) -> dict[str, Any]:
    """Every frame to out (H.264, no audio); returns {dur, ev}."""
    from playwright.sync_api import sync_playwright
    fps = int(os.getenv("BOARD_FPS", "24"))
    srv, port = _serve(work)
    url = f"http://127.0.0.1:{port}/index.html" + ("?q=1.5" if os.getenv("BOARD_FULL") else "?q=1&lite")
    try:
        with sync_playwright() as p:
            b, pg = _open(p, url)
            dur, ev = pg.evaluate("window.DUR"), pg.evaluate("window.EV")
            cdp = pg.context.new_cdp_session(pg)
            n = int(dur * fps)
            ff = subprocess.Popen([FF, "-v", "error", "-y", "-f", "image2pipe", "-c:v", "mjpeg", "-r", str(fps), "-i", "-",
                                   "-c:v", "libx264", "-crf", "19", "-preset", "medium", "-pix_fmt", "yuv420p", str(out)], stdin=subprocess.PIPE)
            t0 = time.monotonic()
            for i in range(n):
                pg.evaluate(f"window.render({i / fps})")
                ff.stdin.write(__import__("base64").b64decode(cdp.send("Page.captureScreenshot", {"format": "jpeg", "quality": 92, "optimizeForSpeed": True})["data"]))
                if i % (fps * 10) == 0:
                    print(f"[board] frame {i}/{n} ({time.monotonic() - t0:.0f}s)", file=sys.stderr)
                if pg.errors:
                    raise RuntimeError(f"page error: {pg.errors[0]}")
            ff.stdin.close()
            if ff.wait() != 0:
                raise RuntimeError("ffmpeg failed while encoding the frames")
            b.close()
    finally:
        srv.shutdown()
    return {"dur": dur, "ev": ev}


# ───────── sound: voices, the track (ducked), soft marker strokes, pings
def _read(path: Path) -> np.ndarray:
    with wave.open(str(path)) as w:
        x = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768
        sr = w.getframerate()
    return np.interp(np.arange(int(len(x) * SR / sr)) * sr / SR, np.arange(len(x)), x).astype(np.float32)


def _smooth(x: np.ndarray, k: int) -> np.ndarray:
    return np.convolve(x, np.ones(k) / k, "same")


def mix(work: Path, dur: float, ev: list[dict[str, Any]]) -> Path:
    rng = np.random.default_rng(3)
    n = int((dur + .5) * SR)
    vo = np.zeros(n, np.float32)
    starts = json.loads((work / "voices" / "vo.json").read_text())
    for lid, t in starts.items():
        if t is None or not np.isfinite(t):
            continue
        x = _read(work / "voices" / f"{lid}.wav"); i = int(t * SR)
        vo[i:i + len(x)] += x[: max(0, n - i)]
    fol = np.zeros(n, np.float32)
    for e in ev:
        t, d0 = float(e.get("t") or 0), float(e.get("dur") or .1)
        if not (np.isfinite(t) and np.isfinite(d0)):   # 22.11: one NaN-timed stroke crashed a finished video
            continue
        i = int(t * SR)
        if i >= n:
            continue
        ty = e.get("type")
        if ty in ("stroke", "write", "dash", "tap"):
            d = max(.03, float(e.get("dur", .1))); m = int(d * SR); u = np.linspace(0, 1, m)
            hiss = np.diff(rng.standard_normal(m + 1)).astype(np.float32)               # felt on gloss: bright noise
            env = (1 - .8 * np.cos(2 * np.pi * u)) / 1.8 * np.minimum(1, u * d / .006) * np.minimum(1, (1 - u) * d / .012)
            s = hiss * env * .05
        elif ty == "erase":
            d = float(e.get("dur", .6)); m = int(d * SR); u = np.linspace(0, 1, m)
            s = _smooth(rng.standard_normal(m), 6).astype(np.float32) * (.45 + .55 * np.abs(np.sin(np.pi * u * 7))) * .12
        elif ty in ("ping", "yes", "pop"):
            m = int(.5 * SR); tt = np.arange(m) / SR
            f = {"ping": 1568 * 2 ** ([0, 4, 7, 12][int(e.get("k", 0)) % 4] / 12), "yes": 2093.0, "pop": 880.0}[ty]
            s = (np.sin(2 * np.pi * f * tt) * np.exp(-tt / (.25 if ty == "yes" else .14)) * .16).astype(np.float32)
        else:
            continue
        fol[i:i + len(s)] += s[: max(0, n - i)]
    music = beat.music(work, n)
    mus = np.zeros(n, np.float32) if music is None else music.astype(np.float32)
    duck = _smooth(np.abs(vo), int(.12 * SR)); duck = np.clip(duck / (duck.max() * .2 + 1e-9), 0, 1)
    fade = np.ones(n, np.float32); k = int(1.2 * SR); fade[-k:] = np.linspace(1, 0, k)
    vr = np.sqrt(np.mean(vo[np.abs(vo) > 1e-3] ** 2)) if np.any(np.abs(vo) > 1e-3) else .1
    mr = np.sqrt(np.mean(mus ** 2)) + 1e-9
    out = vo + mus / mr * vr * .62 * (1 - .45 * duck) * fade + fol
    out /= max(1., np.abs(out).max() / .95)
    path = work / "mix.wav"
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((np.repeat(out[: int(dur * SR), None], 2, 1) * 32767).astype(np.int16).tobytes())
    return path


def make_video(topic: str, work: Path, notes: str | None = None) -> dict[str, Any]:
    s = board_script.write_script(topic, notes)
    shutil.copytree(PAGE, work, dirs_exist_ok=True)
    (work / "script.json").write_text(json.dumps(s, ensure_ascii=False, indent=1), encoding="utf-8")
    board_voice.narrate(s["lines"], work)
    if beat.fetch_track(__import__("random").choice(list(beat.TRACKS)), work):   # CC BY: the credit goes into the caption
        s["caption"] = f"{s['caption']}\n\n{beat.CREDIT}".strip()
    silent = work / "out" / "video.mp4"; silent.parent.mkdir(exist_ok=True)
    r = render(work, silent)
    wav = mix(work, r["dur"], r["ev"])
    out = work / "upload.mp4"
    subprocess.run([FF, "-v", "error", "-y", "-i", str(silent), "-i", str(wav), "-c:v", "copy", "-af", "loudnorm=I=-14:TP=-1.5:LRA=11",
                    "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-shortest", "-movflags", "+faststart", str(out)], check=True, timeout=900)
    cover = work / "cover.jpg"
    first_board = min((s2 for s2 in json.loads(json.dumps(r["ev"])) if s2.get("type") == "write"), key=lambda e: e["t"], default={"t": 2.5})
    subprocess.run([FF, "-v", "error", "-y", "-ss", f"{max(2.0, first_board['t'] + 2.0):.2f}", "-i", str(silent), "-frames:v", "1", "-q:v", "2", str(cover)],
                   check=False, timeout=120)
    segments = [{"focus": L["speaker"], "action": L["emotion"], "text": L["text"]} for L in s["lines"]]
    return {"title": s["title"], "caption": s["caption"], "hashtags": s["hashtags"], "segments": segments, "sources": s["sources"],
            "topic": topic, "lang": "en", "file": out, "cover": cover if cover.exists() else None, "seconds": round(r["dur"], 1), "style": "board"}


if __name__ == "__main__":
    import tempfile
    w = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(tempfile.mkdtemp(prefix="board-"))
    print(make_video(sys.argv[1] if len(sys.argv) > 1 else "how does tap to pay work", w))
