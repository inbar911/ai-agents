"""mix.wav: narration + a synthesized beat (no music files, no licences), ducked under the voice.
Five moods with their own tempo, groove and chords; the beat stays soft through the hook and the full
groove drops in when segment 2 starts."""
import json, re, sys, wave
from pathlib import Path
import numpy as np

SR = 48000
rng = np.random.default_rng(7)

A, Bb, C, D, E, F, G = 110.0, 116.54, 130.81, 146.83, 164.81, 174.61, 196.0
# bpm, kicks / snares / hats per 16 steps (1 = hit), bass roots per bar, pad (soft chords) and arp (8th-note synth line)
MOODS = {
    "pop":     dict(bpm=104, kick="1000000010100000", snare="0000100000001000", hat="1010101010101010", roots=[A, F, C, G], pad=False, arp=False),
    "lofi":    dict(bpm=86,  kick="1000000101000000", snare="0000100000001000", hat="1010101110101010", roots=[D, Bb, F, C], pad=True, arp=False),
    "electro": dict(bpm=124, kick="1000100010001000", snare="0000100000001000", hat="0010001000100010", roots=[A, A, F, G], pad=False, arp=True),
    "chill":   dict(bpm=78,  kick="1000000000100000", snare="0000000010000000", hat="1000100010001000", roots=[C, A, F, G], pad=True, arp=False),
    "trap":    dict(bpm=140, kick="1000000000100100", snare="0000000010000000", hat="1111111111111111", roots=[A, A, F, E], pad=False, arp=False),
}


def narration(root: Path) -> np.ndarray:
    with wave.open(str(root / "narration.wav")) as w:
        x = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768
        sr = w.getframerate()
    return np.interp(np.arange(int(len(x) * SR / sr)) * sr / SR, np.arange(len(x)), x)


def env(n, k): return np.exp(-np.arange(n) / SR * k)


def kick():
    n = int(0.35 * SR); t = np.arange(n) / SR
    return np.sin(2 * np.pi * np.cumsum(50 + 110 * np.exp(-t * 28)) / SR) * env(n, 9)


def snare():
    n = int(0.25 * SR); t = np.arange(n) / SR
    noise = rng.standard_normal(n); noise = noise - np.convolve(noise, np.ones(6) / 6, "same")
    return 0.5 * np.sin(2 * np.pi * 190 * t) * env(n, 30) + 0.6 * noise * env(n, 22)


def hat():
    n = int(0.05 * SR); x = rng.standard_normal(n)
    return (x - np.convolve(x, np.ones(3) / 3, "same")) * env(n, 90) * 0.35


def synth(freq, dur, kind="bass"):
    n = int(dur * SR); t = np.arange(n) / SR
    if kind == "bass":
        return np.tanh(2.2 * np.sin(2 * np.pi * freq * t)) * np.minimum(1, t / 0.01) * env(n, 2.5) * 0.5
    if kind == "pad":   # soft triad, slow attack
        x = sum(np.sin(2 * np.pi * freq * m * t + 0.3 * np.sin(2 * np.pi * 0.5 * t)) for m in (1, 1.26, 1.5))
        return x * np.minimum(1, t / 0.4) * np.minimum(1, (dur - t) / 0.4).clip(0) * 0.12
    x = np.sign(np.sin(2 * np.pi * freq * t)) * 0.5 + np.sin(2 * np.pi * freq * 2 * t) * 0.5   # arp pluck
    return x * env(n, 14) * 0.18


def place(buf, x, at):
    i = int(at * SR)
    if i < len(buf): buf[i:i + len(x)] += x[:len(buf) - i]


# 15.11: real music under the voice. Kevin MacLeod tracks (CC BY 4.0, credit in every caption), picked by Gemini for
# energy and fit against the reel Inbar liked (uplifting electronic ~120 BPM); 70 s cuts that start on the full groove,
# kept in the private bucket channel-music (not in this public repo). name -> BPM (the engine syncs its cuts to it).
TRACKS = {"digital_lemonade": 128, "voxel_revolution": 128, "electrodoodle": 125, "hyperfun": 126, "rhinoceros": 124, "pamgaea": 118}
MUSIC_BUCKET = "channel-music"
CREDIT = "Music: Kevin MacLeod (incompetech.com) · CC BY 4.0"


def fetch_track(name: str, root: Path) -> bool:
    """work/music.mp3 from the bucket; False (a video with voice only) when it can't be fetched."""
    try:
        from lib.supabase_client import sb
        (root / "music.mp3").write_bytes(sb().storage.from_(MUSIC_BUCKET).download(f"{name}.mp3"))
        return True
    except Exception as e:
        print(f"[channel] music {name} not fetched: {e}", file=sys.stderr)
        return False


def music(root: Path, n: int) -> np.ndarray | None:
    """work/music.mp3 decoded to n mono samples (looped if short), or None."""
    f = root / "music.mp3"
    if not f.exists():
        return None
    import shutil, subprocess
    raw = subprocess.run([shutil.which("ffmpeg") or "ffmpeg", "-v", "error", "-i", str(f), "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
                         capture_output=True, check=True, timeout=120).stdout
    x = np.frombuffer(raw, np.float32).astype(np.float64)
    if len(x) == 0:
        return None
    return np.tile(x, n // len(x) + 1)[:n]


def main(root: Path, mood: str = "pop") -> None:
    m = MOODS.get(mood, MOODS["pop"])
    voice = narration(root)
    timing = json.loads(re.sub(r"^window.TIMING = |;\s*$", "", (root / "timing.js").read_text(encoding="utf-8")))
    drop = timing[1]["a"] if len(timing) > 1 else 0.0
    total = len(voice) / SR + 1.2
    beat = np.zeros(int(total * SR) + SR)
    step = 60 / m["bpm"] / 4
    track = music(root, len(beat))
    # the synthesized groove is only the fallback when no track could be fetched (it scored 3/10 energy vs. real music)
    for k in range(int(total / step) if track is None else 0):
        t, s, bar = k * step, k % 16, k // 16
        full = t >= drop - 0.01
        if m["kick"][s] == "1" and (full or s == 0): place(beat, kick() * (1 if full else 0.5), t)
        if full and m["snare"][s] == "1": place(beat, snare() * 0.55, t)
        if m["hat"][s] == "1": place(beat, hat() * ((0.7 + 0.3 * (s % 2 == 0)) if full else 0.3), t)
        root_f = m["roots"][bar % 4]
        if full and s in (0, 8): place(beat, synth(root_f / 2, step * 7, "bass") * 0.8, t)
        if m["pad"] and s == 0: place(beat, synth(root_f * 2, step * 16, "pad"), t)
        if m["arp"] and full and s % 2 == 0: place(beat, synth(root_f * (2, 3, 4, 3)[(s // 2) % 4], step * 2, "arp"), t)
    # duck the beat under the voice (envelope follower), gently: it should still be heard while he talks
    if track is not None:   # the music plays from the first frame and fades out at the end
        fade = np.ones(len(beat)); k = int(0.8 * SR); fade[-k:] = np.linspace(1, 0, k)
        beat = track * fade
    v = np.zeros_like(beat); v[:len(voice)] = np.abs(voice)
    win = int(0.08 * SR)
    envv = np.convolve(v, np.ones(win) / win, "same")
    beat = beat / (np.abs(beat).max() + 1e-9) * 0.32 * (1 - 0.35 * np.clip(envv / (envv.max() * 0.25 + 1e-9), 0, 1))
    mix = beat.copy(); mix[:len(voice)] += voice * 0.95
    mix = mix[: int(total * SR)]
    mix /= max(1.0, np.abs(mix).max() / 0.95)
    st = (np.stack([mix, mix], 1) * 32767).astype(np.int16)
    with wave.open(str(root / "mix.wav"), "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(st.tobytes())


if __name__ == "__main__":
    main(Path(sys.argv[1]), sys.argv[2] if len(sys.argv) > 2 else "pop")
