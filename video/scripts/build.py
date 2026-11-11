"""Stamps scene/audio timing into index.html and builds assets/sfx.mp3 + assets/music.mp3.
Run from video/ after scripts/make-vo.py:  python3 scripts/build.py"""
import json, re, subprocess, wave, numpy as np
T = json.load(open("assets/vo/timings.json")); total = T["total"]; sc = {int(k): v for k, v in T["scenes"].items()}
N = max(sc); OVER = 0.36
h = open("index.html").read()
def stamp(m):
    n = int(m.group(1)); end = sc[n + 1] + OVER if n < N else total
    return f'data-scene="{n}" data-start="{sc[n]:g}" data-duration="{round(end - sc[n], 3):g}"'
h = re.sub(r'data-scene="(\d+)" data-start="[\d.]+" data-duration="[\d.]+"', stamp, h)
h = re.sub(r'(data-composition-id="main" data-start="0" data-duration=")[\d.]+', rf"\g<1>{total:g}", h)
h = re.sub(r'(id="(?:music|sfx)"[^>]*data-duration=")[\d.]+', rf"\g<1>{total:g}", h)
vo = "\n".join(f'      <audio id="vo{i:02d}" src="assets/vo/{i:02d}.wav" data-start="{l["start"]:g}" data-duration="{l["dur"]:g}" data-volume="1" data-track-index="4"></audio>' for i, l in enumerate(T["lines"], 1))
h = re.sub(r"<!--VO-->.*<!--/VO-->", "<!--VO-->\n" + vo + "\n      <!--/VO-->", h, flags=re.S)
open("index.html", "w").write(h)

SR = 44100; n = int(SR * total); rng = np.random.default_rng(11)
def tone(f, d, a=0.004, dec=0.12, h2=0.0):
    t = np.arange(int(d * SR)) / SR
    return (np.sin(2 * np.pi * f * t) + h2 * np.sin(4 * np.pi * f * t)) * np.minimum(t / a, 1) * np.exp(-t / dec)
def noise(d): return rng.standard_normal(int(d * SR))
def lp(x, k):  # one-pole low-pass, k in (0,1]
    y = np.empty_like(x); acc = 0.0
    for i, v in enumerate(x): acc += k * (v - acc); y[i] = acc
    return y
def sweep(f0, f1, d, dec):
    t = np.arange(int(d * SR)) / SR; f = f0 * (f1 / f0) ** (t / d)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / dec)
def env(x, a, r):
    m = len(x); e = np.minimum(np.arange(m) / (a * SR), 1) * np.minimum((m - np.arange(m)) / (r * SR), 1); return x * e
def lay(*parts):
    L = max(len(x) + int(d * SR) for x, d in parts); o = np.zeros(L)
    for x, d in parts: i = int(d * SR); o[i:i + len(x)] += x
    return o
FX = {
 "whoosh": lambda: env(lp(noise(0.34), 0.25) - lp(noise(0.34), 0.03), 0.2, 0.12) * 0.9,
 "pop": lambda: sweep(420, 900, 0.07, 0.03) * 0.6,
 "tick": lambda: tone(2200, 0.03, 0.001, 0.008) * 0.35,
 "click": lambda: lay((tone(1500, 0.04, 0.001, 0.012) * 0.5, 0), (tone(700, 0.05, 0.001, 0.02) * 0.3, 0)),
 "thud": lambda: lay((sweep(130, 42, 0.3, 0.09) * 1.1, 0), (env(lp(noise(0.06), 0.3), 0.002, 0.05) * 0.25, 0)),
 "boom": lambda: lay((sweep(95, 34, 0.7, 0.25) * 1.2, 0), (env(lp(noise(0.5), 0.05), 0.01, 0.4) * 0.5, 0)),
 "ding": lambda: lay((tone(1320, 0.7, 0.002, 0.22, 0.3) * 0.4, 0), (tone(1980, 0.5, 0.002, 0.15) * 0.2, 0)),
 "coin": lambda: np.concatenate([tone(1568, 0.06, 0.001, 0.05) * 0.35, tone(2093, 0.4, 0.001, 0.13) * 0.35]),
 "blip": lambda: lay((tone(880, 0.09, 0.002, 0.04) * 0.4, 0), (tone(1320, 0.09, 0.002, 0.04) * 0.4, 0.05)),
 "buzz": lambda: env(lay((np.sign(np.sin(2 * np.pi * 92 * np.arange(int(0.3 * SR)) / SR)) * 0.22, 0), (tone(184, 0.3, 0.002, 0.3) * 0.2, 0)), 0.004, 0.08),
 "clank": lambda: lay((tone(523, 0.25, 0.001, 0.06) * 0.25, 0), (tone(1187, 0.2, 0.001, 0.04) * 0.25, 0), (tone(1789, 0.15, 0.001, 0.03) * 0.25, 0), (env(noise(0.03), 0.001, 0.02) * 0.2, 0)),
 "shimmer": lambda: lay(*[(tone(f, 0.5, 0.002, 0.16) * 0.14, i * 0.05) for i, f in enumerate([1760, 2217, 2637, 3520])]),
 "boot": lambda: lay((sweep(220, 880, 0.35, 0.3) * 0.3, 0), (tone(1320, 0.3, 0.002, 0.1) * 0.3, 0.3)),
 "down": lambda: sweep(660, 110, 0.6, 0.4) * 0.35,
 "shatter": lambda: lay((env(noise(0.4) - lp(noise(0.4), 0.2), 0.001, 0.35) * 0.35, 0), *[(tone(f, 0.25, 0.001, 0.05) * 0.15, d) for f, d in [(2400, 0), (3100, 0.03), (1900, 0.07), (2800, 0.11)]]),
}
ev = json.loads(subprocess.run(["node", "scripts/sfx-events.cjs", "index.html"], capture_output=True, text=True, check=True).stdout)
out = np.zeros(n)
for t, name, g in ev:
    s = FX[name](); i = int(t * SR)
    if 0 <= i < n: j = min(n, i + len(s)); out[i:j] += s[: j - i] * g
out = np.tanh(out * 1.2) * 0.8
def save(path, x):
    pcm = (np.stack([x, x], 1) * 32767).astype(np.int16)
    with wave.open("/tmp/_oiko.wav", "wb") as w: w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", "/tmp/_oiko.wav", "-b:a", "160k", path], check=True)
save("assets/sfx.mp3", out)

# ---------- music: quiet minor bed for the problem, full groove from the reveal, extra lift for the agent act ----------
DROP, LIFT, END = sc[5], sc[9], sc[17]; BEAT = DROP / 20; bar = 4 * BEAT
m = np.zeros(n); f = lambda k: 440 * 2 ** ((k - 69) / 12)
def add(sig, t, g=1.0):
    i = int(t * SR)
    if 0 <= i < n: j = min(n, i + len(sig)); m[i:j] += sig[: j - i] * g
def pluck(k, d=0.5): t = np.arange(int(d * SR)) / SR; return (np.sin(2*np.pi*f(k)*t) + 0.35*np.sin(4*np.pi*f(k)*t) + 0.12*np.sin(6*np.pi*f(k)*t)) * np.minimum(t/0.004, 1) * np.exp(-t/0.16)
def pad(ks, d): t = np.arange(int(d * SR)) / SR; return sum(np.sin(2*np.pi*f(k)*t) + 0.5*np.sin(2*np.pi*f(k)*1.004*t) for k in ks) * np.minimum(t/0.4, 1) * np.minimum((d-t)/0.5, 1) / len(ks)
def kick(): t = np.arange(int(0.28 * SR)) / SR; return np.sin(2*np.pi*(45*t + 3*(1-np.exp(-t/0.05)))) * np.exp(-t/0.09)
def hat(d=0.012): s = np.diff(noise(0.06), prepend=0); return s * np.exp(-np.arange(len(s)) / (d * SR))
def clap(): s = np.diff(noise(0.16), prepend=0); return s * np.exp(-np.arange(len(s)) / (0.04 * SR))
def bass(k, d): t = np.arange(int(d * SR)) / SR; return (np.sin(2*np.pi*f(k)*t) + 0.25*np.sin(4*np.pi*f(k)*t)) * np.minimum(t/0.01, 1) * np.exp(-t/0.35)
CH = [([57, 60, 64], 45), ([53, 57, 60], 41), ([48, 52, 55], 36), ([55, 59, 62], 43)]
for b in range(int(total / bar) + 1):
    t0 = b * bar; notes, root = CH[b % 4]; full = t0 >= DROP - 1e-6; lift = t0 >= LIFT - bar / 2; outro = t0 >= END - 1e-6
    add(pad(notes, bar + 0.3), t0, 0.07 if full else 0.10)
    for s in range(8):
        ts = t0 + s * BEAT / 2
        if full:
            arp = notes + [notes[0] + 12]
            add(pluck(arp[(s * 3) % 4] + 12), ts, 0.16)
            if lift and not outro: add(pluck(arp[(s * 5 + 1) % 4] + 24, 0.3), ts + BEAT / 4, 0.07); add(hat(0.03), ts + BEAT / 4, 0.02)
            add(hat(), ts, 0.05 if s % 2 else 0.025)
            if s % 2 == 0 and not outro: add(kick(), ts, 0.55)
            if s in (2, 6) and not outro: add(clap(), ts, 0.07)
            if s in (0, 3, 6): add(bass(root, BEAT * 0.9), ts, 0.30)
        elif s in (0, 3, 6): add(pluck(notes[s % 3] + 12, 0.8), ts, 0.10)
for tt in (DROP, LIFT, END):
    L = int(1.2 * SR); t = np.arange(L) / SR; add(np.diff(noise(1.2) * (t / 1.2) ** 2, prepend=0), tt - 1.2, 0.12)
fd = int(2.5 * SR); m[n - fd:] *= np.linspace(1, 0, fd) ** 2
m = np.tanh(m * 1.4); m /= np.max(np.abs(m)) * 1.15
save("assets/music.mp3", m)
print("built: total", total, "sfx cues", len(ev))
