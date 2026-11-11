"""Generates the voiceover clips (assets/vo/NN.wav) and assets/vo/timings.js.
Word times are anchored to the pauses detected in each clip, then spread by word length.
Run from video/:  python3 scripts/make-vo.py"""
import json, os, re, numpy as np, soundfile as sf
from kokoro_onnx import Kokoro
C = os.path.expanduser("~/.cache/hyperframes/tts")
k = Kokoro(f"{C}/models/kokoro-v1.0.onnx", f"{C}/voices/voices-v1.0.bin")
VOICE = "am_michael"  # try af_bella, af_heart or am_puck for a different read
# (spoken text, caption text, speed, gap after in seconds, scene id that starts on this line or None)
L = [
 ("Payday! Twelve hundred dollars!", "Payday. | Twelve hundred *dollars.", 1.05, 0.45, 1),
 ("Nine days later? Forty-one.", "Nine days later? | *Forty-one.", 1.05, 0.95, 2),
 ("Subscriptions. Takeout. One quick transfer.", "Subscriptions. Takeout. | One *quick transfer.", 1.05, 0.5, 3),
 ("The plan was in your head. Your money never saw it.", "The plan was in your head. | Your money *never saw it.", 1.05, 0.75, 4),
 ("So we built Oyko!", "So we built *Oiko.", 1.0, 1.25, 5),
 ("Claim a name, and get paid from anywhere!", "Claim a name, | and get paid from *anywhere.", 1.05, 0.6, 6),
 ("Every payment splits itself. Bills. Savings. Goals. Spend.", "Every payment *splits itself. | Bills. Savings. Goals. Spend.", 1.05, 0.55, 7),
 ("Lock a pot, and it stays locked. Even from you!", "Lock a pot, and it stays locked. | *Even *from *you.", 1.05, 1.0, 8),
 ("Now, the part we're proudest of. Bring your own AI agent!", "Now, the part we're proudest of. | Bring *your *own AI agent.", 1.0, 0.55, 9),
 ("Oyko has no built-in AI. You connect the one you already use.", "Oiko has *no built-in AI. | You connect the one you already use.", 1.03, 0.9, 10),
 ("You decide what it can do. Read. Suggest. Or act.", "*You decide what it can do. | Read. Suggest. Or act.", 1.03, 0.4, 11),
 ("How much it can spend. And who it can pay.", "How much it can *spend. | And who it can *pay.", 1.03, 0.6, None),
 ("It never touches your keys! It gets its own, with your limits written into the account.", "It *never touches your keys. || It gets its own, with your limits | written into the account.", 1.03, 0.95, 12),
 ("Inside the limit? Paid!", "Inside the limit? | *Paid.", 1.03, 0.45, 13),
 ("Over it? The account says no.", "Over it? | The account says *no.", 1.0, 1.7, None),
 ("It can even suggest a better plan. You just tap approve!", "It can even suggest a better plan. | You just tap *approve.", 1.03, 1.1, 14),
 ("Changed your mind? One tap, and its key is gone.", "Changed your mind? | One tap, and its key is *gone.", 1.03, 1.1, 15),
 ("Your money. Your plan. Your agent. Your rules!", "Your money. Your plan. | Your agent. *Your *rules.", 0.97, 0.7, 16),
 ("Oyko. Personal finance, meets personal intelligence.", "", 0.9, 0.55, 17),
 ("It's live! Go claim your name.", "", 0.97, 2.6, None),
]
wt = lambda w: len(re.sub(r"\W", "", w)) + 2 + (3 if w[-1] in ".?,!" else 0)
def segments(a, sr):
    """Speech segments separated by real pauses (>= 0.13 s of silence)."""
    w = int(sr * 0.02); e = np.sqrt(np.convolve(a * a, np.ones(w) / w, "same")); on = e > 0.012
    idx = np.flatnonzero(on); first, last = idx[0], idx[-1]
    segs, s0, i = [], first, first
    while i < last:
        if not on[i]:
            j = i
            while j < last and not on[j]: j += 1
            if j - i > sr * 0.13: segs.append((s0 / sr, i / sr)); s0 = j
            i = j
        else: i += 1
    segs.append((s0 / sr, last / sr))
    return segs
def assign(segs, phrases):
    """Group the phrases into len(segs) contiguous runs whose lengths best match the segment durations."""
    from itertools import combinations
    pw = [sum(wt(w) for w in ws) + 3 for ws in phrases]; P, K = len(phrases), len(segs)
    if K > P: return None
    D = sum(e - s for s, e in segs); W = sum(pw); best = None
    for cuts in combinations(range(1, P), K - 1):
        b = (0,) + cuts + (P,)
        cost = sum(abs((segs[j][1] - segs[j][0]) / D - sum(pw[b[j]:b[j + 1]]) / W) for j in range(K))
        if best is None or cost < best[0]: best = (cost, b)
    b = best[1]
    return [sum(phrases[b[j]:b[j + 1]], []) for j in range(K)]
os.makedirs("assets/vo", exist_ok=True)
t = 0.35; out = []; scenes = {}
for n, (spoken, cap, speed, gap, scene) in enumerate(L, 1):
    a, sr = k.create(spoken, VOICE, speed=speed)
    # a little presence: compress, brighten, normalise the peak
    a = a / max(1e-6, np.max(np.abs(a))) * 0.5; a = np.tanh(a * 2.2) / np.tanh(2.2) * 0.89
    sf.write(f"assets/vo/{n:02d}.wav", a, sr); dur = len(a) / sr
    phrases = [p.split() for p in re.findall(r"[^.?,!]+[.?,!]?", spoken) if p.strip()]
    segs = segments(a, sr); groups = assign(segs, phrases); times = []
    if groups is None:
        print(f"  line {n}: more pauses than phrases, spreading evenly")
        segs = [(0.02, dur - 0.05)]; groups = [spoken.split()]
    phrases = groups
    for (s, e), ws in zip(segs, phrases):
        tot = sum(wt(w) for w in ws); acc = 0
        for w in ws: times.append(round(t + s + (e - s) * acc / tot, 3)); acc += wt(w)
    if scene: scenes[scene] = round(t - 0.3, 3)
    out.append({"start": round(t, 3), "dur": round(dur, 3), "cap": cap, "t": times})
    print(f"{n:02d} {t:6.2f} {dur:5.2f}  {spoken}")
    t += dur + gap
total = round(t, 2); scenes[1] = 0
json.dump({"total": total, "scenes": scenes, "lines": out}, open("assets/vo/timings.json", "w"), indent=1)
open("assets/vo/timings.js", "w").write("window.VO = " + json.dumps({"total": total, "scenes": scenes, "lines": out}) + ";\n")
print("total", total, scenes)
