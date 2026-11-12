"""Collects CC0 candidate models for the channel's 3D library from Poly Pizza (which hosts Quaternius, Kenney, Google Poly).

Per keyword: the search results, CC0 only, the first few models' GLB + preview into tools/model_candidates/,
plus candidates.json (title, creator, licence, source page). Curation happens after: only picked models go into
the engine's library. Polite: one request at a time with a pause; run it by hand, not in CI.

Run: `python tools/fetch_models.py [per_keyword=3]`
"""
from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path

import httpx

OUT = Path(__file__).parent / "model_candidates"
KEYWORDS = [
    # devices & tech
    "smartphone", "phone", "laptop", "computer", "monitor", "keyboard", "mouse computer", "tablet", "router", "server rack",
    "headphones", "earbuds", "smartwatch", "television", "game controller", "console", "camera", "drone", "robot",
    "microphone", "speaker", "battery", "usb", "cable", "chip", "circuit board", "hard drive", "printer", "vr headset",
    "satellite", "satellite dish", "antenna", "radio tower", "cell tower", "solar panel", "wind turbine", "power plant",
    "light bulb", "lamp", "electric car", "charging station", "traffic light", "cctv camera", "atm", "credit card",
    # vehicles & transport
    "airplane", "jet", "helicopter", "rocket", "space shuttle", "car", "truck", "bus", "train", "subway", "bicycle",
    "motorcycle", "ship", "submarine", "police car", "ambulance",
    # places & scenes
    "house", "apartment building", "skyscraper", "office building", "factory", "data center", "hospital", "school",
    "airport", "road", "bridge", "city", "street", "gas station", "store", "warehouse",
    # home & everyday
    "fridge", "washing machine", "dishwasher", "microwave", "oven", "air conditioner", "fan", "sofa", "bed", "desk",
    "chair", "door", "window", "clock", "coffee machine", "toaster", "vacuum cleaner", "water bottle", "backpack",
    "book", "pizza", "burger", "coin", "money", "shopping cart", "gift box", "key", "padlock", "safe",
    # body & nature (for analogies)
    "brain", "eye", "hand", "heart organ", "tree", "mountain", "cloud", "sun", "moon", "planet", "earth globe", "water drop",
    "fire", "lightning",
    # people
    "person", "astronaut", "doctor",
]
UA = {"User-Agent": "Mozilla/5.0 (ai-agents model curation; contact via github inbar911)"}


def search(c: httpx.Client, kw: str) -> list[dict]:
    html = c.get(f"https://poly.pizza/search/{kw}").text
    m = re.search(r"window\.__SERVER_APP_STATE__ =\s*(\{.*?\})\s*</script>", html, re.S)
    if not m:
        return []
    return json.loads(m.group(1)).get("initialData", {}).get("result", [])


def main() -> None:
    per = int(sys.argv[1]) if len(sys.argv) > 1 else 3
    OUT.mkdir(exist_ok=True)
    index_path = OUT / "candidates.json"
    index = json.loads(index_path.read_text(encoding="utf-8")) if index_path.exists() else {}
    with httpx.Client(timeout=60, headers=UA, follow_redirects=True) as c:
        for kw in KEYWORDS:
            got = 0
            for r in search(c, kw):
                if got >= per:
                    break
                if r.get("licence") != "CC0 1.0":
                    continue
                pid = r["publicID"]
                uid = r["previewUrl"].rsplit("/", 1)[-1].rsplit(".", 1)[0]
                if pid in index:
                    got += 1
                    continue
                glb = c.get(f"https://static.poly.pizza/{uid}.glb")
                if not glb.is_success or len(glb.content) > 4_000_000:
                    continue
                (OUT / f"{pid}.glb").write_bytes(glb.content)
                prev = c.get(r["previewUrl"])
                if prev.is_success:
                    (OUT / f"{pid}.webp").write_bytes(prev.content)
                index[pid] = {"keyword": kw, "title": r["title"], "creator": r["creator"]["username"], "licence": r["licence"],
                              "page": f"https://poly.pizza/m/{pid}", "kb": len(glb.content) // 1024}
                got += 1
                time.sleep(1.0)
            print(f"{kw}: {got}", flush=True)
            index_path.write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")
            time.sleep(1.5)
    print(f"total {len(index)} candidates")


if __name__ == "__main__":
    main()
