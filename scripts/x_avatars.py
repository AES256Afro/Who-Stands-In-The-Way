#!/usr/bin/env python3
"""Current X profile pictures for everyone with an X handle, without an API key: one archived post id per
handle from the Internet Archive CDX index, then that post's public embed data (cdn.syndication.twimg.com),
whose user record carries the account's current profile image. Writes data/raw/x_avatars.json
{politician_id: image url}. Re-run to refresh; handles already done are kept unless --refresh.
"""
import concurrent.futures as cf, json, pathlib, subprocess, sys, time

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "raw" / "x_avatars.json"
people = json.load(open(ROOT / "seed" / "seed.json"))["politicians"]
extra = ROOT / "data" / "raw" / "state_officials.json"
if extra.exists():
    so = json.load(open(extra))
    people += so if isinstance(so, list) else so.get("politicians", [])
done = {} if "--refresh" in sys.argv or not OUT.exists() else json.load(open(OUT))


def get(url):
    # curl: this Python has no CA bundle.
    r = subprocess.run(["curl", "-sfL", "--max-time", "40", "-A", "who-stands-in-the-way/1.0", url], capture_output=True)
    return r.stdout if r.returncode == 0 else None


def avatar(handle):
    for attempt in range(3):
        raw = get(f"https://web.archive.org/cdx/search/cdx?url=x.com/{handle}/status/*&output=json&limit=-8&fl=original")
        if raw is not None:
            break
        time.sleep(5 * (attempt + 1))
    try:
        rows = json.loads(raw or b"[]")[1:]
    except ValueError:
        rows = []
    ids = []
    for (u,) in rows:
        tail = u.rstrip("/").split("/")[-1].split("?")[0]
        if tail.isdigit():
            ids.append(tail)
    for pid in reversed(ids):
        data = get(f"https://cdn.syndication.twimg.com/tweet-result?id={pid}&token=a")
        try:
            user = json.loads(data or b"{}").get("user") or {}
        except ValueError:
            continue
        img = user.get("profile_image_url_https") or ""
        if img and user.get("screen_name", "").lower() == handle.lower() and "default_profile" not in img:
            return img.replace("_normal.", "_400x400.")
    return None


todo = {}
# Senators first, then the House, governors and statewide officials, state legislators last.
ORDER = {"senate": 0, "house": 1, "executive": 1, "governor": 2, "statewide": 2}
people.sort(key=lambda p: (ORDER.get(p.get("chamber"), 3), p["id"]))
for p in people:
    h = (p.get("twitter") or "").strip().lstrip("@")
    if h and p["id"] not in done:
        todo[p["id"]] = h
print("to look up", len(todo), flush=True)
with cf.ThreadPoolExecutor(int(next((a.split("=")[1] for a in sys.argv if a.startswith("--threads=")), 10))) as ex:
    futs = {ex.submit(avatar, h): pid for pid, h in todo.items()}
    for i, f in enumerate(cf.as_completed(futs), 1):
        url = f.result()
        if url:
            done[futs[f]] = url
        if i % 25 == 0:
            OUT.write_text(json.dumps(done, indent=0))
            print(i, "found", len(done), flush=True)
OUT.write_text(json.dumps(done, indent=0))
print("avatars", len(done))
