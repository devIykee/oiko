/* Oiko film timeline. Scene and word times come from assets/vo/timings.js (scripts/make-vo.py). */
window.__timelines = window.__timelines || {};
window.__sfx = [];
(function () {
  const VO = window.VO;
  const tl = gsap.timeline({ paused: true });
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const N = 17;
  const S = (n) => (n > N ? VO.total : VO.scenes[n]);
  const W = (line, word) => VO.lines[line - 1].t[word];
  const sfx = (t, name, gain = 1) => window.__sfx.push([Math.round(t * 1000) / 1000, name, gain]);
  let seed = 20261111;
  const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const R = (a, b) => a + (b - a) * rnd();
  const MARK = '<svg viewBox="0 0 24 24"><use href="#p-mark" /></svg>';
  const FACE = (m = "") => `<div class="face"><i class="eye"><b></b></i><i class="eye"><b></b></i><b class="mouth ${m}"></b><i class="cheek l"></i><i class="cheek r"></i></div>`;

  /* ---------- build repeated characters ---------- */
  $$("[data-jar]").forEach((j) => {
    const [name, c1, c2, lock] = j.dataset.jar.split("|");
    j.innerHTML = `<div class="lid" style="background:${c1}"></div><div class="glass"><div class="liq" style="background:linear-gradient(180deg,${c2},${c1})"></div></div><div class="shine"></div>${FACE()}` +
      (lock ? `<svg class="plock" viewBox="0 0 100 100" style="color:#ffc83d"><use href="#p-lock" /></svg>` : "") +
      (name ? `<div class="tagl">${name}</div><div class="amt body num"><span>0</span> USDT</div>` : "");
  });
  $$(".bot").forEach((b) => {
    b.innerHTML = `<div class="ant"></div><div class="arm l"></div><div class="arm r"></div><div class="torso"><div class="chest">${MARK}</div></div><div class="head"><div class="ear l"></div><div class="ear r"></div><div class="visor"><i class="beye l"></i><i class="beye r"></i></div></div>`;
  });
  const make = (parent, n, cls, html = "") => { const out = []; for (let i = 0; i < n; i++) { const d = document.createElement("div"); d.className = cls; d.innerHTML = html; $(parent).appendChild(d); out.push(d); } return out; };
  const CONF = ["#3d5afe", "#f0364a", "#2bd47d", "#ffffff", "#8a72ff", "#ffc83d"];

  /* ---------- helpers ---------- */
  const pop = (sel, t, o = {}) => tl.fromTo(sel, { opacity: 0, scale: o.from ?? 0.4 }, { opacity: 1, scale: 1, duration: o.d ?? 0.4, ease: o.ease ?? "back.out(2.2)" }, t);
  const slam = (sel, t, o = {}) => { tl.fromTo(sel, { opacity: 0, scale: o.from ?? 2.6 }, { opacity: 1, scale: 1, duration: o.d ?? 0.22, ease: "power4.in" }, t); sfx(t + (o.d ?? 0.22), o.sfx ?? "thud", o.gain ?? 1); };
  const rise = (sel, t, o = {}) => tl.fromTo(sel, { opacity: 0, y: o.y ?? 140 }, { opacity: 1, y: 0, duration: o.d ?? 0.5, ease: o.ease ?? "back.out(1.5)" }, t);
  const count = (el, from, to, t, d, fmt = (v) => String(Math.round(v)), ease = "power2.out") => { const o = { v: from }; tl.to(o, { v: to, duration: d, ease, onUpdate: () => { el.textContent = fmt(o.v); } }, t); };
  const shake = (sel, t, amp = 26, n = 7) => { for (let i = 0; i < n; i++) { const k = i === n - 1 ? 0 : (i % 2 ? 1 : -1) * (1 - i / n); tl.to(sel, { x: k * amp, y: k * amp * 0.35 * (i % 3 ? 1 : -1), duration: 0.05, ease: "none" }, t + i * 0.05); } };
  const blink = (sel, times) => times.forEach((t) => tl.to(sel, { scaleY: 0.1, duration: 0.07, yoyo: true, repeat: 1, ease: "power1.inOut" }, t));
  const bob = (sel, t0, t1, amp = 12, per = 1.1) => { const n = Math.max(1, Math.round((t1 - t0) / per)); tl.to(sel, { y: `-=${amp}`, duration: (t1 - t0) / n / 2, ease: "sine.inOut", yoyo: true, repeat: n * 2 - 1 }, t0); };
  const squash = (sel, t) => { tl.to(sel, { scaleY: 0.86, scaleX: 1.1, duration: 0.09, ease: "power2.out" }, t); tl.to(sel, { scaleY: 1, scaleX: 1, duration: 0.45, ease: "elastic.out(1.2,0.4)" }, t + 0.09); };
  const tap = (cur, btn, x, y, t, from = [1800, 1100]) => {
    tl.fromTo(cur, { x: from[0], y: from[1], opacity: 0 }, { x, y, opacity: 1, duration: 0.5, ease: "power3.out" }, t - 0.55);
    tl.to(cur, { scale: 0.7, duration: 0.07, yoyo: true, repeat: 1 }, t);
    tl.to(btn, { scale: 0.9, y: 6, duration: 0.07, yoyo: true, repeat: 1 }, t);
    tl.to(cur, { opacity: 0, duration: 0.2 }, t + 0.45);
    sfx(t, "click");
  };
  const confetti = (parent, n, cx, cy, t, spread = 900) => {
    make(parent, n, "conf").forEach((c, i) => {
      c.style.background = CONF[i % CONF.length];
      const a = R(-Math.PI, 0), d = R(0.35, 1) * spread, dx = Math.cos(a) * d * 1.2, dy = Math.sin(a) * d;
      tl.fromTo(c, { x: cx, y: cy, opacity: 1, rotation: 0, scale: R(0.6, 1.3) }, { x: cx + dx, y: cy + dy, rotation: R(-500, 500), duration: 0.55, ease: "power3.out", immediateRender: false }, t);
      tl.to(c, { y: cy + dy + R(300, 700), opacity: 0, rotation: `+=${R(-300, 300)}`, duration: R(0.8, 1.3), ease: "power1.in" }, t + 0.55);
    });
  };
  const sparks = (parent, pts, t, color = "#fff") => {
    make(parent, pts.length, "spark").forEach((s, i) => {
      s.style.left = pts[i][0] + "px"; s.style.top = pts[i][1] + "px"; s.style.background = color;
      const k = pts[i][2] ?? 1, tt = t + i * 0.07;
      tl.fromTo(s, { scale: 0, opacity: 1, rotation: 0 }, { scale: k, rotation: 90, duration: 0.25, ease: "back.out(3)", immediateRender: false }, tt);
      tl.to(s, { scale: 0, opacity: 0, rotation: 180, duration: 0.35, ease: "power2.in" }, tt + 0.3);
    });
  };
  const botBlink = (id, times) => blink(`${id} .beye`, times);
  const wave = (id, t, n = 3) => { tl.to(`${id} .arm.r`, { rotation: -150, duration: 0.2, ease: "power2.out" }, t); tl.to(`${id} .arm.r`, { rotation: -115, duration: 0.14, yoyo: true, repeat: n * 2 - 1, ease: "sine.inOut" }, t + 0.2); tl.to(`${id} .arm.r`, { rotation: -18, duration: 0.25, ease: "power2.inOut" }, t + 0.2 + n * 0.28); };

  /* ---------- scene transitions and camera drift ---------- */
  const WHIP = { 10: 1, 11: 1, 12: 1, 13: 1, 14: 1 }; // scenes entered with a sideways whip instead of a zoom
  for (let n = 1; n <= N; n++) {
    const sc = `#s${n}`, cam = `#s${n} .cam`, t0 = S(n), t1 = S(n + 1);
    $(sc).style.zIndex = String(40 - n);
    if (n > 1) {
      if (WHIP[n]) tl.fromTo(sc, { x: 1920 }, { x: 0, duration: 0.42, ease: "power3.out" }, t0);
      else tl.fromTo(cam, { scale: 0.72 }, { scale: 1, duration: 0.55, ease: "expo.out" }, t0);
      sfx(t0 - 0.08, "whoosh", n === 5 || n === 9 || n === 17 ? 1.2 : 0.8);
    }
    tl.to(cam, { scale: 1.05, duration: Math.max(0.5, t1 - t0 - 0.6), ease: "none" }, t0 + 0.6);
    if (n < N) {
      if (WHIP[n + 1]) tl.to(sc, { x: -1920, duration: 0.34, ease: "power2.in" }, t1 - 0.02);
      else tl.to(sc, { scale: 1.7, opacity: 0, duration: 0.3, ease: "power2.in" }, t1);
    }
    $$(`${sc} .blob`).forEach((b, i) => tl.fromTo(b, { x: 0, y: 0 }, { x: i % 2 ? -90 : 90, y: i % 2 ? 60 : -60, duration: t1 - t0 + 0.4, ease: "sine.inOut" }, t0));
    $$(`${sc} .grid, ${sc} .dots`).forEach((g) => tl.fromTo(g, { x: 0, y: 0 }, { x: -60, y: -40, duration: t1 - t0 + 0.4, ease: "none" }, t0));
  }

  /* ---------- captions ---------- */
  const capRoot = $("#captions");
  VO.lines.forEach((ln, li) => {
    if (!ln.cap) return;
    const next = VO.lines[li + 1];
    const lineEnd = Math.min(next ? next.start - 0.1 : VO.total, ln.start + ln.dur + 1.0);
    let wi = 0;
    const pages = ln.cap.split(" || "); // "||" starts a fresh caption card, "|" a new row
    const starts = []; { let k = 0; pages.forEach((pg) => { starts.push(ln.t[k]); k += pg.split(" ").filter((w) => w !== "|").length; }); }
    pages.forEach((pg, pi) => {
      const row = document.createElement("div"); row.className = "cap";
      let first = true; const spans = [];
      pg.split(" ").forEach((w) => {
        if (w === "|") { if (spans.length) spans[spans.length - 1].classList.add("last"); const br = document.createElement("div"); br.className = "br"; row.appendChild(br); first = true; return; }
        const sp = document.createElement("span"); sp.textContent = w.replace("*", "");
        if (w.startsWith("*")) sp.classList.add("hl");
        if (first) { sp.classList.add("first"); first = false; }
        row.appendChild(sp); spans.push(sp);
        tl.fromTo(sp, { opacity: 0, scale: 0.6, y: 16 }, { opacity: 1, scale: 1, y: 0, duration: 0.16, ease: "back.out(2.5)" }, Math.max(0, ln.t[wi] - 0.07));
        wi++;
      });
      spans[spans.length - 1].classList.add("last");
      capRoot.appendChild(row);
      const end = pi < pages.length - 1 ? starts[pi + 1] - 0.1 : lineEnd;
      tl.set(row, { opacity: 1 }, Math.max(0, starts[pi] - 0.12));
      tl.to(row, { opacity: 0, y: -20, duration: 0.12, ease: "power2.in" }, end - 0.12);
    });
  });
  tl.set("#mark", { opacity: 1 }, S(6) + 0.3);
  tl.set("#mark", { opacity: 0 }, S(17));

  /* ================= 1 · payday ================= */
  {
    const t = W(1, 1) - 0.1;
    tl.fromTo("#notif", { scale: 1.22, rotation: -3 }, { scale: 1.16, rotation: -1.5, duration: 0.6, ease: "power2.out" }, 0);
    sfx(0.05, "ding");
    tl.to("#notif", { x: 430, y: -300, scale: 0.6, rotation: 7, duration: 0.45, ease: "back.out(1.3)" }, t);
    slam("#s1-num", t, { from: 3, d: 0.24, gain: 1.2 });
    shake("#s1 .cam", t + 0.24, 22);
    confetti("#s1-conf", 40, 960, 560, t + 0.24, 1000);
    make("#s1-coins", 7, "coin", "$").forEach((c, i) => {
      const x = [120, 330, 1650, 1480, 90, 1730, 760][i], y = [300, 800, 700, 180, 620, 420, 880][i], k = [1, 0.7, 1.1, 0.6, 0.8, 0.75, 0.6][i];
      c.style.left = x + "px"; c.style.top = y + "px";
      tl.fromTo(c, { scale: 0, rotation: -90 }, { scale: k, rotation: R(-20, 20), duration: 0.45, ease: "back.out(2)" }, t + 0.26 + i * 0.05);
      bob(c, t + 0.8, S(2) + 0.3, 16 + i * 2, 0.9);
    });
    sfx(t + 0.3, "coin"); sfx(t + 0.42, "coin", 0.7);
    tl.to("#s1-num", { scale: 1.05, duration: 1.2, ease: "none" }, t + 0.3);
  }

  /* ================= 2 · nine days later ================= */
  {
    const a = S(2) + 0.3, b = W(2, 3);
    count($("#s2-num"), 1200, 41, a, b - a, (v) => "$" + Math.round(v).toLocaleString("en-US"), "power1.in");
    count($("#s2-day"), 1, 9, a, b - a, (v) => String(Math.round(v)), "none");
    pop("#s2-cal", S(2) + 0.15);
    for (let i = 0; i < 8; i++) { tl.to("#s2-cal", { rotation: i % 2 ? 6 : 9, duration: 0.06, ease: "none" }, a + ((b - a) * (i + 0.5)) / 8); sfx(a + ((b - a) * (i + 0.5)) / 8, "tick", 0.7); }
    $$("#s2 .tx").forEach((x, i) => {
      x.style.top = "0px"; x.style.left = 1340 + (i % 3) * 22 + "px";
      const tt = S(2) + 0.15 + ((b - S(2)) * i) / 10;
      tl.fromTo(x, { y: 1150, rotation: R(-6, 6) }, { y: -180, rotation: R(-6, 6), duration: 0.85, ease: "none" }, tt);
    });
    tl.fromTo("#s2-num", { scale: 1 }, { scale: 1.3, duration: 0.1, ease: "power2.in" }, b - 0.1);
    tl.to("#s2-num", { scale: 1, duration: 0.4, ease: "elastic.out(1.1,0.4)" }, b);
    sfx(b, "thud", 1.2); sfx(b + 0.02, "buzz", 0.6);
    shake("#s2 .cam", b, 34);
    pop("#s2-gone", b + 0.4, { from: 1.8, ease: "power4.out", d: 0.25 });
  }

  /* ================= 3 · the suspects ================= */
  {
    tl.fromTo("#s3-cone", { opacity: 0 }, { opacity: 1, duration: 0.08 }, S(3) + 0.12); sfx(S(3) + 0.12, "clank", 0.8);
    [["#sus1", W(3, 0)], ["#sus2", W(3, 1)], ["#sus3", W(3, 2)]].forEach(([s, t], i) => {
      tl.fromTo(s, { y: -1100 }, { y: 0, duration: 0.32, ease: "power2.in" }, t - 0.3);
      squash(`${s} .bodyb`, t + 0.02); sfx(t + 0.02, "thud", 0.8);
      tl.fromTo(`${s} .plac`, { scale: 0, rotation: -12 }, { scale: 1, rotation: [-3, 2, -2][i], duration: 0.35, ease: "back.out(2.2)" }, t + 0.1);
      tl.fromTo(`${s} .tagn`, { scale: 0 }, { scale: 1, duration: 0.25, ease: "back.out(3)" }, t + 0.25); sfx(t + 0.25, "pop", 0.6);
      tl.fromTo(`${s} .hand`, { scale: 0 }, { scale: 1, duration: 0.2 }, t + 0.2);
      tl.to(`${s} .face`, { x: 14, duration: 0.18, ease: "power2.inOut" }, t + 0.5);
      tl.to(`${s} .face`, { x: -14, duration: 0.22, ease: "power2.inOut" }, t + 0.85);
      tl.to(`${s} .face`, { x: 0, duration: 0.18, ease: "power2.inOut" }, t + 1.25);
      blink(`${s} .eye`, [t + 0.4, t + 1.5]);
    });
    tl.to("#sus3 .plac .am", { scale: 1.25, duration: 0.15, yoyo: true, repeat: 1, ease: "power2.out" }, W(3, 4));
  }

  /* ================= 4 · the plan was in your head ================= */
  {
    const t = S(4);
    pop("#tb1", t + 0.1, { d: 0.25 }); pop("#tb2", t + 0.2, { d: 0.25 }); pop("#cloud", t + 0.3, { from: 0.5, d: 0.5 }); sfx(t + 0.1, "pop", 0.5); sfx(t + 0.2, "pop", 0.6); sfx(t + 0.3, "pop", 0.9);
    tl.fromTo("#s4 .prow", { opacity: 0, x: -40 }, { opacity: 1, x: 0, duration: 0.22, stagger: 0.08, ease: "power3.out" }, t + 0.55);
    bob("#cloud", t + 0.9, W(4, 8), 14, 1.0);
    const t2 = W(4, 6) - 0.25;
    make("#runners", 5, "runner", `<div class="coin"></div>${FACE()}<div class="leg a"></div><div class="leg b"></div>`).forEach((r, i) => {
      const tt = t2 + i * 0.2;
      tl.fromTo(r, { x: 0 }, { x: 2350, duration: 1.7, ease: "none" }, tt);
      tl.fromTo(r, { y: 0 }, { y: -26, duration: 0.11, ease: "sine.out", yoyo: true, repeat: 15 }, tt);
      tl.fromTo(r.querySelector(".leg.a"), { rotation: 40 }, { rotation: -40, duration: 0.11, ease: "none", yoyo: true, repeat: 15 }, tt);
      tl.fromTo(r.querySelector(".leg.b"), { rotation: -40 }, { rotation: 40, duration: 0.11, ease: "none", yoyo: true, repeat: 15 }, tt);
      sfx(tt + 0.3, "tick", 0.5);
    });
    tl.to(["#cloud", "#tb1", "#tb2"], { opacity: 0.22, scale: 0.94, duration: 0.45, ease: "power2.out" }, W(4, 8));
  }

  /* ================= 5 · reveal ================= */
  {
    const t = S(5);
    tl.fromTo("#ray5", { rotation: 0 }, { rotation: 26, duration: S(6) - t + 0.4, ease: "none" }, t);
    tl.fromTo("#s5-logo", { scale: 0.05, rotation: -14, opacity: 0 }, { scale: 1, rotation: 0, opacity: 1, duration: 0.6, ease: "back.out(1.7)" }, t + 0.12);
    sfx(t + 0.3, "boom", 1.3); sfx(t + 0.45, "shimmer");
    ["#r1", "#r2", "#r3"].forEach((r, i) => tl.fromTo(r, { scale: 0.3, opacity: 0.9 }, { scale: 4, opacity: 0, duration: 1.2, ease: "power2.out" }, t + 0.35 + i * 0.2));
    sparks("#s5-sparks", [[420, 300, 1.6], [1480, 280, 1.2], [1540, 700, 1.8], [360, 720, 1.1], [960, 210, 1], [1230, 800, 1.3], [640, 830, 0.9], [1650, 480, 1]], t + 0.5);
    tl.fromTo("#s5-sub", { opacity: 0, y: 30 }, { opacity: 0.92, y: 0, duration: 0.4, ease: "power3.out" }, W(5, 3) + 0.25);
    tl.to("#s5-logo", { scale: 1.06, duration: 1.4, ease: "none" }, t + 0.75);
  }

  /* ================= 6 · claim a name, get paid from anywhere ================= */
  {
    const t = S(6);
    tl.fromTo("#paycard", { y: 900, rotation: -6 }, { y: 0, rotation: 0, duration: 0.55, ease: "back.out(1.3)" }, t + 0.05);
    const nm = { v: 0 };
    tl.to(nm, { v: 5, duration: 0.4, ease: "none", onUpdate: () => { $("#pc-name").textContent = "steve".slice(0, Math.round(nm.v)); } }, W(6, 0));
    for (let i = 0; i < 5; i++) sfx(W(6, 0) + i * 0.08, "tick", 0.5);
    slam("#pc-claimed", W(6, 2), { from: 2.4, d: 0.18, sfx: "pop" });
    const amt = $("#pc-amt"), sums = [0, 100, 350, 390, 465];
    const t2 = W(6, 4);
    ["#cc1", "#cc2", "#cc3", "#cc4"].forEach((c, i) => {
      const el = $(c), cx = parseFloat(el.style.left) + 95, cy = parseFloat(el.style.top) + 95;
      tl.fromTo(c, { scale: 0, rotation: -40 }, { scale: 1, rotation: 0, duration: 0.4, ease: "back.out(2)" }, t + 0.3 + i * 0.09);
      bob(c, t + 0.8 + i * 0.1, t2 + i * 0.24, 14, 0.7);
      const tt = t2 + i * 0.24;
      tl.to(c, { x: 960 - cx, y: 580 - cy, scale: 0.25, rotation: 360, duration: 0.42, ease: "power2.in" }, tt);
      tl.to(c, { opacity: 0, duration: 0.05 }, tt + 0.4);
      tl.fromTo(`#pr${i + 1}`, { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: 0.2, ease: "power3.out" }, tt + 0.42);
      count(amt, sums[i], sums[i + 1], tt + 0.42, 0.22, (v) => v.toFixed(2));
      tl.to("#paycard", { scale: 1.04, duration: 0.08, yoyo: true, repeat: 1, ease: "power2.out" }, tt + 0.42);
      sfx(tt + 0.42, "coin", 0.9);
    });
    $("#pc-amt").textContent = "0.00";
  }

  /* ================= 7 · every payment splits itself ================= */
  {
    const t = S(7);
    tl.fromTo("#s7-pay", { y: -500, rotation: -8 }, { y: 0, rotation: 0, duration: 0.5, ease: "back.out(1.5)" }, t + 0.05); sfx(t + 0.3, "ding");
    tl.fromTo("#s7-bar", { scaleX: 0 }, { scaleX: 1, duration: 0.5, ease: "expo.out" }, W(7, 2) - 0.1); sfx(W(7, 2) - 0.1, "whoosh", 0.5);
    const jars = ["#j1", "#j2", "#j3", "#j4", "#j5"], amts = [30, 20, 10, 10, 30], lvl = [0.74, 0.52, 0.3, 0.3, 0.74];
    const at = [W(7, 4), W(7, 5), W(7, 6), W(7, 6) + 0.16, W(7, 7)];
    jars.forEach((j, i) => {
      tl.fromTo(j, { y: 700 }, { y: 0, duration: 0.5, ease: "back.out(1.4)" }, t + 0.25 + i * 0.07);
      tl.set(`${j} .liq`, { scaleY: 0 }, 0);
      const el = $(j), jx = parseFloat(el.style.left) + 130, tt = at[i] - 0.3;
      make("#s7-drops", 4, "coin sm").forEach((c, k) => {
        tl.fromTo(c, { x: jx - 28 + R(-30, 30), y: 400, opacity: 1, scale: 1 }, { y: 610, duration: 0.3, ease: "power2.in", immediateRender: false }, tt + k * 0.06);
        tl.to(c, { opacity: 0, scale: 0.4, duration: 0.06 }, tt + k * 0.06 + 0.3);
        c.style.opacity = "0";
      });
      tl.to(`${j} .liq`, { scaleY: lvl[i], duration: 0.55, ease: "elastic.out(1,0.6)" }, at[i]);
      squash(j + " .glass", at[i]);
      count($(`${j} .amt span`), 0, amts[i], at[i], 0.4);
      sfx(at[i], "coin", 0.9); sfx(at[i] + 0.05, "pop", 0.5);
      blink(`${j} .eye`, [at[i] + 0.5, t + 1 + i * 0.3]);
      tl.to(`${j} .face`, { y: -8, duration: 0.15, yoyo: true, repeat: 1 }, at[i] + 0.05);
    });
    tl.to(jars, { y: -30, duration: 0.2, stagger: 0.06, ease: "power2.out", yoyo: true, repeat: 1 }, W(7, 7) + 0.55);
  }

  /* ================= 8 · locked stays locked ================= */
  {
    const t = S(8);
    tl.fromTo("#lockcard", { x: -900, rotation: -8 }, { x: 0, rotation: 0, duration: 0.5, ease: "back.out(1.2)" }, t + 0.05);
    tl.set("#bigjar .liq", { scaleY: 0.6 }, 0);
    tl.fromTo("#bigjar", { y: 900 }, { y: 0, duration: 0.55, ease: "back.out(1.3)" }, t + 0.12);
    tl.fromTo("#chain8", { scaleX: 0 }, { scaleX: 1, duration: 0.3, ease: "power3.out" }, W(8, 0));
    tl.fromTo("#biglock", { y: -800, rotation: -30 }, { y: 0, rotation: 0, duration: 0.3, ease: "power2.in" }, W(8, 0) + 0.05);
    tl.to("#biglock", { rotation: 8, duration: 0.08, yoyo: true, repeat: 3, ease: "sine.inOut" }, W(8, 0) + 0.35); sfx(W(8, 0) + 0.35, "clank");
    blink("#bigjar .eye", [t + 0.9, W(8, 7) + 0.3]);
    const tp = W(8, 5);
    tap("#cur8", "#wbtn", 300, 750, tp);
    shake("#lockcard", tp + 0.12, 30);
    [7, -7, 5, -5, 0].forEach((r, i) => tl.to("#bigjar", { rotation: r, duration: 0.09, ease: "sine.inOut" }, tp + 0.12 + i * 0.09));
    tl.fromTo("#toast8", { y: 240, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35, ease: "back.out(1.8)" }, tp + 0.15); sfx(tp + 0.12, "buzz");
    const te = W(8, 7);
    tl.to("#biglock", { scale: 1.35, duration: 0.16, ease: "back.out(3)", yoyo: true, repeat: 1 }, te);
    sparks("#s8-sparks", [[1150, 470, 1.4], [1530, 500, 1.1], [1480, 760, 1.5], [1120, 720, 1]], te, "#ffc83d"); sfx(te, "shimmer", 0.8);
  }

  /* ================= 9 · bring your own agent ================= */
  {
    const t = S(9);
    tl.fromTo("#cone9", { opacity: 0 }, { opacity: 1, duration: 0.1 }, t + 0.25); sfx(t + 0.25, "clank", 0.7);
    tl.fromTo("#bot9", { y: 900 }, { y: 0, duration: 0.6, ease: "back.out(1.5)" }, t + 0.35); sfx(t + 0.5, "boot");
    bob("#bot9", t + 1.0, S(10) + 0.3, 14, 0.9);
    botBlink("#bot9", [t + 1.3, t + 2.6, t + 3.6]);
    const tb = W(9, 6) - 0.1;
    wave("#bot9", tb, 4);
    tl.fromTo("#s9-title", { x: 300, opacity: 0, scale: 0.7 }, { x: 0, opacity: 1, scale: 1, duration: 0.45, ease: "back.out(1.6)" }, tb); sfx(tb, "boom", 0.8);
    pop("#s9c1", W(9, 7)); pop("#s9c2", W(9, 8)); pop("#s9c3", W(9, 10)); [7, 8, 10].forEach((w) => sfx(W(9, w), "pop", 0.7));
    sparks("#s9-sparks", [[330, 430, 1.2], [760, 520, 1], [250, 840, 0.9], [800, 780, 1.3]], tb + 0.2, "#7df9ff");
  }

  /* ================= 10 · no built-in AI; connect yours ================= */
  {
    const t = S(10);
    pop("#noai", t + 0.2, { from: 0.7, d: 0.35 });
    slam("#noai-stamp", W(10, 2) - 0.1, { from: 3, d: 0.18 }); shake("#noai", W(10, 2) + 0.08, 14);
    const t2 = W(10, 5) - 0.3;
    tl.to("#noai", { y: 1000, rotation: 24, duration: 0.4, ease: "power2.in" }, t2);
    tl.fromTo("#hub", { scale: 0, rotation: -90 }, { scale: 1, rotation: 0, duration: 0.5, ease: "back.out(1.8)" }, t2 + 0.25); sfx(t2 + 0.3, "boom", 0.7);
    const from = [[-700, -200], [700, -200], [-700, 200], [700, 200]], src = [[560, 395, 820, 500], [1360, 395, 1100, 500], [560, 765, 820, 660], [1360, 765, 1100, 660]];
    const t3 = W(10, 6) - 0.05, gap = (W(10, 11) - t3) / 4;
    ["#ag1", "#ag2", "#ag3", "#ag4"].forEach((a, i) => {
      const tt = t3 + i * gap;
      tl.fromTo(a, { x: from[i][0], y: from[i][1], opacity: 0 }, { x: 0, y: 0, opacity: 1, duration: 0.4, ease: "back.out(1.6)" }, tt); sfx(tt + 0.1, "pop", 0.7);
      tl.fromTo(`#w${i + 1}`, { scaleX: 0 }, { scaleX: 1, duration: 0.25, ease: "power3.out" }, tt + 0.3);
      const p = `#pu${i + 1}`;
      tl.fromTo(p, { x: src[i][0] - 15, y: src[i][1] - 15, opacity: 1 }, { x: src[i][2] - 15, y: src[i][3] - 15, duration: 0.3, ease: "none", repeat: 2, immediateRender: false }, tt + 0.5);
      tl.set(p, { opacity: 0 }, tt + 1.4);
      tl.to("#hub", { scale: 1.08, duration: 0.08, yoyo: true, repeat: 1 }, tt + 0.8); sfx(tt + 0.8, "blip", 0.6);
    });
    tl.set(["#w1", "#w2", "#w3", "#w4"], { scaleX: 0 }, 0);
    pop("#s10mcp", W(10, 10));
  }

  /* ================= 11 · you decide ================= */
  {
    const t = S(11);
    tl.fromTo("#sheet", { y: 1000 }, { y: 0, duration: 0.5, ease: "back.out(1.2)" }, t + 0.15);
    bob("#bot11", t + 0.5, S(12), 10, 1.0);
    botBlink("#bot11", [t + 1.2, t + 3.1, t + 5.2]);
    tl.to("#bot11 .head", { rotation: 8, duration: 0.3, ease: "power2.out" }, t + 0.7);
    [[1, W(11, 6)], [2, W(11, 7)], [3, W(11, 9)]].forEach(([i, tt]) => {
      tl.to(`#tg${i} .k`, { x: 68, duration: 0.2, ease: "back.out(2)" }, tt);
      tl.to(`#tg${i} .on`, { opacity: 1, duration: 0.15 }, tt);
      tl.to(`#pA .trow:nth-child(${i}) .a`, { scale: 1.15, x: 14, duration: 0.12, yoyo: true, repeat: 1 }, tt);
      sfx(tt, "click", 1.1);
      tl.to("#bot11", { y: "-=24", duration: 0.1, yoyo: true, repeat: 1, ease: "power2.out" }, tt + 0.05);
    });
    const t2 = W(12, 0) - 0.3;
    tl.to("#pA", { opacity: 0, y: -70, duration: 0.22, ease: "power2.in" }, t2);
    tl.fromTo("#pB", { opacity: 0, y: 90 }, { opacity: 1, y: 0, duration: 0.3, ease: "power3.out" }, t2 + 0.2); sfx(t2 + 0.1, "whoosh", 0.5);
    [[1, 0.4, 40, W(12, 1) - 0.1], [2, 0.5, 50, W(12, 2)], [3, 1, 100, W(12, 4) - 0.15]].forEach(([i, k, v, tt]) => {
      tl.fromTo(`#cf${i}`, { scaleX: 0 }, { scaleX: k, duration: 0.4, ease: "back.out(1.6)" }, tt);
      count($(`#cv${i}`), 0, v, tt, 0.35); sfx(tt, "blip", 0.7);
    });
    tl.set(["#cf1", "#cf2", "#cf3"], { scaleX: 0 }, 0);
    pop("#al1", W(12, 6)); pop("#al2", W(12, 6) + 0.2); pop("#al3", W(12, 9) - 0.1); sfx(W(12, 6), "pop", 0.7); sfx(W(12, 6) + 0.2, "pop", 0.7); sfx(W(12, 9) - 0.1, "buzz", 0.5);
    shake("#al3", W(12, 9) + 0.25, 10);
    tl.to("#bot11 .head", { rotation: 0, duration: 0.3 }, W(12, 9));
  }

  /* ================= 12 · never your keys ================= */
  {
    const t = S(12);
    tl.fromTo("#vault", { scale: 0.6, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.45, ease: "back.out(1.5)" }, t + 0.2);
    pop("#yourkey", t + 0.5); bob("#yourkey", t + 1, S(13), 8, 0.8);
    botBlink("#bot12", [t + 1.0, t + 3.4, t + 5.0]);
    tl.to("#bot12", { x: -160, duration: 0.3, ease: "power2.out" }, W(13, 1) - 0.1);
    tl.to("#bot12 .arm.l", { rotation: 80, duration: 0.25 }, W(13, 1) - 0.1);
    slam("#nokey-x", W(13, 2) - 0.1, { from: 3, d: 0.15, sfx: "buzz" });
    tl.to("#bot12", { x: 0, duration: 0.35, ease: "back.out(2)" }, W(13, 2) + 0.1);
    tl.to("#bot12 .arm.l", { rotation: 18, duration: 0.25 }, W(13, 2) + 0.1);
    pop("#yours-tag", W(13, 3)); sfx(W(13, 3), "pop", 0.7);
    const t2 = W(13, 5) - 0.1;
    tl.to("#nokey-x", { opacity: 0, scale: 0.5, duration: 0.2 }, t2);
    tl.fromTo("#botkey", { y: -800, rotation: -200, opacity: 1 }, { y: 0, rotation: -20, duration: 0.5, ease: "bounce.out" }, W(13, 6)); sfx(W(13, 6) + 0.2, "ding");
    bob("#botkey", W(13, 6) + 0.6, S(13), 10, 0.8);
    tl.to("#bot12", { y: "-=30", duration: 0.12, yoyo: true, repeat: 3, ease: "power2.out" }, W(13, 7));
    tl.fromTo("#keytag", { scale: 0, rotation: -12, opacity: 0 }, { scale: 1, rotation: -3, opacity: 1, duration: 0.4, ease: "back.out(2)" }, W(13, 9)); sfx(W(13, 9), "pop");
    tl.fromTo("#keytag div", { opacity: 0, x: -20 }, { opacity: 1, x: 0, duration: 0.18, stagger: 0.14 }, W(13, 10));
    const t3 = W(13, 12) - 0.05;
    tl.to("#dial", { rotation: 360, duration: 0.9, ease: "power2.inOut" }, t3);
    ["#ru1", "#ru2", "#ru3"].forEach((r, i) => { tl.fromTo(r, { opacity: 0, x: 320, scale: 1.3 }, { opacity: 1, x: 0, scale: 1, duration: 0.3, ease: "power3.out" }, t3 + i * 0.22); sfx(t3 + i * 0.22 + 0.25, "click", 0.9); });
    tl.to("#vault", { scale: 1.04, duration: 0.12, yoyo: true, repeat: 1 }, t3 + 0.95); sfx(t3 + 0.95, "clank");
  }

  /* ================= 13 · paid / refused ================= */
  {
    const t = S(13);
    tl.set("#gate-arm", { rotation: -72 }, 0);
    pop("#gate-sign", t + 0.4); pop("#payee", t + 0.3);
    botBlink("#bot13", [t + 0.9]);
    const t1 = W(14, 0) - 0.05, tp = W(14, 3) - 0.05;
    tl.to("#bot13 .arm.r", { rotation: -95, duration: 0.2 }, t1);
    tl.fromTo("#pc1", { x: 420, y: 720, opacity: 0, scale: 0.4 }, { opacity: 1, scale: 1, duration: 0.15 }, t1);
    tl.to("#pc1", { x: 1590, duration: tp - t1, ease: "power1.inOut" }, t1 + 0.05);
    tl.to("#pc1", { y: 640, duration: (tp - t1) / 4, ease: "sine.out", yoyo: true, repeat: 3 }, t1 + 0.05);
    tl.to("#pc1", { scale: 0.2, opacity: 0, y: 600, duration: 0.12 }, tp + 0.05);
    slam("#paid-chip", tp, { from: 2.5, d: 0.16, sfx: "ding" }); sfx(tp + 0.1, "coin");
    squash("#payee", tp + 0.1);
    tl.to("#bot13 .arm.r", { rotation: -18, duration: 0.2 }, tp);
    tl.to("#bot13", { y: "-=40", duration: 0.13, yoyo: true, repeat: 1, ease: "power2.out" }, tp + 0.15);
    const t2 = W(15, 0) - 0.1, tn = W(15, 5) - 0.12;
    tl.to("#paid-chip", { opacity: 0, y: -40, duration: 0.2 }, t2);
    tl.to("#bot13 .arm.r", { rotation: -95, duration: 0.2 }, t2);
    tl.fromTo("#pc2", { x: 400, y: 690, opacity: 0, scale: 0.4 }, { opacity: 1, scale: 1, duration: 0.15 }, t2);
    tl.to("#pc2", { x: 760, duration: 0.5, ease: "power2.in" }, t2 + 0.1);
    tl.to("#gate-arm", { rotation: 0, duration: 0.22, ease: "power3.in" }, t2 + 0.36); sfx(t2 + 0.58, "clank", 1.2);
    tl.to("#gate-arm", { rotation: -5, duration: 0.07, yoyo: true, repeat: 3 }, t2 + 0.58);
    tl.to("#pc2", { x: 520, y: 740, rotation: -360, duration: 0.5, ease: "power2.out" }, t2 + 0.6);
    tl.to("#gate-sign", { scale: 1.2, duration: 0.12, yoyo: true, repeat: 1 }, t2 + 0.6);
    tl.to("#bot13 .beye", { scaleY: 0.25, duration: 0.1 }, t2 + 0.62);
    tl.to("#bot13", { x: -40, rotation: -6, duration: 0.15, yoyo: true, repeat: 1 }, t2 + 0.62);
    tl.fromTo("#s13-flash", { opacity: 0.55 }, { opacity: 0, duration: 0.35, immediateRender: false }, tn);
    slam("#ref-stamp", tn, { from: 3, d: 0.16, sfx: "buzz", gain: 1.2 }); sfx(tn + 0.16, "thud", 1.2);
    shake("#s13 .cam", tn + 0.16, 30);
    tl.fromTo("#fix", { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.3, ease: "back.out(2)" }, tn + 0.6); sfx(tn + 0.6, "pop", 0.7);
    tl.to("#bot13 .beye", { scaleY: 1, duration: 0.15 }, tn + 0.8);
  }

  /* ================= 14 · suggests, you approve ================= */
  {
    const t = S(14);
    rise("#planbar", t + 0.3, { y: 200 });
    bob("#bot14", t + 0.4, W(16, 10), 10, 0.9); botBlink("#bot14", [t + 1.1, t + 2.6]);
    tl.fromTo("#bubble", { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.35, ease: "back.out(2)" }, W(16, 3) - 0.15); sfx(W(16, 3) - 0.15, "pop");
    tl.to("#bot14 .arm.r", { rotation: -120, duration: 0.25 }, W(16, 3) - 0.15);
    tl.fromTo("#wait", { x: 1100, rotation: 8 }, { x: 0, rotation: 0, duration: 0.5, ease: "back.out(1.2)" }, W(16, 6) - 0.2); sfx(W(16, 6) - 0.2, "whoosh", 0.6);
    const ta = W(16, 10);
    tap("#cur14", "#apbtn", 1150, 680, ta);
    tl.fromTo("#okd", { opacity: 0, scale: 0.8 }, { opacity: 1, scale: 1, duration: 0.25, ease: "back.out(2)" }, ta + 0.12); sfx(ta + 0.12, "ding", 1.2);
    tl.to("#pb1", { width: "40%", duration: 0.5, ease: "back.out(1.6)" }, ta + 0.2);
    tl.to("#pb5", { width: "20%", duration: 0.5, ease: "back.out(1.6)" }, ta + 0.2);
    confetti("#s14-conf", 26, 1400, 520, ta + 0.15, 600);
    tl.to("#bot14", { y: "-=70", duration: 0.16, yoyo: true, repeat: 3, ease: "power2.out" }, ta + 0.2);
    tl.to("#bot14 .arm.l", { rotation: 150, duration: 0.2 }, ta + 0.2);
    tl.to("#bot14 .arm.r", { rotation: -150, duration: 0.2 }, ta + 0.2);
  }

  /* ================= 15 · one tap, key gone ================= */
  {
    const t = S(15);
    tl.fromTo("#agrow", { y: -500 }, { y: 0, duration: 0.5, ease: "back.out(1.3)" }, t + 0.15);
    tl.set("#st-b", { opacity: 0 }, 0);
    bob("#bot15", t + 0.3, W(17, 9) - 0.2, 10, 0.9); bob("#key15", t + 0.3, W(17, 9) - 0.2, 14, 0.7);
    botBlink("#bot15", [t + 1.0]);
    const tt = W(17, 4);
    tap("#cur15", "#dbtn", 1330, 362, tt);
    tl.set("#st-a", { opacity: 0 }, tt + 0.12); tl.set("#st-b", { opacity: 1 }, tt + 0.12);
    const tg = W(17, 9) - 0.15;
    tl.to("#key15", { scale: 1.3, duration: 0.1 }, tg - 0.1);
    tl.set("#key15", { opacity: 0 }, tg);
    make("#shards", 10, "shard").forEach((s, i) => {
      const a = (i / 10) * Math.PI * 2, d = R(250, 520);
      tl.fromTo(s, { x: 925, y: 705, opacity: 1, rotation: 0, scale: R(0.5, 1.2) }, { x: 925 + Math.cos(a) * d, y: 705 + Math.sin(a) * d, rotation: R(-400, 400), opacity: 0, duration: 0.6, ease: "power2.out", immediateRender: false }, tg);
    });
    sfx(tg, "shatter", 1.2);
    tl.to("#bot15 .beye", { scaleY: 0.1, background: "#5e636e", boxShadow: "0 0 0 rgba(0,0,0,0)", duration: 0.25 }, tg + 0.05);
    tl.to("#bot15", { y: "+=36", opacity: 0.55, duration: 0.5, ease: "power2.out" }, tg + 0.05);
    tl.to("#bot15 .head", { rotation: 10, duration: 0.5 }, tg + 0.05); sfx(tg + 0.1, "down");
    slam("#gone-stamp", tg + 0.25, { from: 2.6, d: 0.16 });
  }

  /* ================= 16 · your money, plan, agent, rules ================= */
  {
    $("#art2").innerHTML = [150, 230, 110, 300, 190].map((h, i) => `<div class="pbar" style="position:absolute;bottom:40px;left:${84 + i * 66}px;width:48px;height:${h}px;border-radius:16px;background:${["#3d5afe", "#0e8a5f", "#5b3fe0", "#e0701a", "#16181d"][i]};transform-origin:50% 100%;box-shadow:0 8px 0 rgba(0,0,0,.18)"></div>`).join("");
    tl.set("#j16 .liq", { scaleY: 0.62 }, 0);
    [["#st1", W(18, 0)], ["#st2", W(18, 2)], ["#st3", W(18, 4)], ["#st4", W(18, 6)]].forEach(([s, tt], i) => {
      tl.fromTo(s, { y: i % 2 ? -1080 : 1080 }, { y: 0, duration: 0.38, ease: "expo.out" }, tt - 0.1); sfx(tt - 0.05, "thud", 0.9);
      tl.fromTo(`${s} .art`, { scale: 0.3, rotation: -20 }, { scale: 1, rotation: 0, duration: 0.45, ease: "back.out(2)" }, tt);
      tl.fromTo(`${s} .lab b`, { x: -60, opacity: 0 }, { x: 0, opacity: 1, duration: 0.3, ease: "power3.out" }, tt + 0.08);
    });
    tl.fromTo("#art2 .pbar", { scaleY: 0 }, { scaleY: 1, duration: 0.35, stagger: 0.05, ease: "back.out(2)" }, W(18, 2) + 0.1);
    wave("#bot16", W(18, 4) + 0.2, 2);
    tl.to("#lock16", { rotation: 14, duration: 0.09, yoyo: true, repeat: 3 }, W(18, 6) + 0.3); sfx(W(18, 6) + 0.3, "clank", 0.8);
    blink("#j16 .eye", [W(18, 0) + 0.6, W(18, 6) + 0.5]);
  }

  /* ================= 17 · close ================= */
  {
    const t = S(17);
    tl.fromTo("#ray17", { rotation: 0 }, { rotation: 50, duration: VO.total - t, ease: "none" }, t);
    tl.fromTo("#s17-logo", { scale: 0.1, opacity: 0, rotation: -10 }, { scale: 1, opacity: 1, rotation: 0, duration: 0.5, ease: "back.out(1.8)" }, W(19, 0) - 0.12); sfx(W(19, 0), "boom", 1.1); sfx(W(19, 0) + 0.1, "shimmer", 0.8);
    $$("#s17 .tagw").forEach((w, i) => {
      tl.fromTo(w, { opacity: 0, y: 90, rotation: 6 }, { opacity: 1, y: 0, rotation: 0, duration: 0.4, ease: "back.out(1.8)" }, W(19, i + 1) - 0.08); sfx(W(19, i + 1) - 0.05, "pop", 0.5);
    });
    tl.to("#tag2", { scale: 1.06, duration: 0.2, yoyo: true, repeat: 1, ease: "power2.out" }, W(19, 5) + 0.55);
    const tc = W(20, 0) - 0.15;
    tl.fromTo("#cta", { y: 500, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: "back.out(1.5)" }, tc); sfx(tc + 0.1, "whoosh", 0.6);
    [["#jc1", 0], ["#jc2", 0.1], ["#jc3", 0.2], ["#bot17", 0.3]].forEach(([c, d]) => {
      tl.fromTo(c, { y: 700 }, { y: 0, duration: 0.55, ease: "back.out(1.6)" }, tc + 0.15 + d);
      bob(c, tc + 0.8 + d, VO.total, 14, 0.8);
    });
    tl.set(["#jc1 .liq", "#jc2 .liq", "#jc3 .liq"], { scaleY: 0.6 }, 0);
    wave("#bot17", tc + 0.9, 5);
    blink("#jc1 .eye, #jc2 .eye, #jc3 .eye", [tc + 1.2, tc + 2.6]); botBlink("#bot17", [tc + 1.6, tc + 3.0]);
    const tt = W(20, 3) + 0.1;
    tap("#cur17", "#ctabtn", 1250, 690, tt, [1500, 1100]);
    confetti("#s17-conf", 50, 960, 700, tt + 0.1, 1100); sfx(tt + 0.1, "ding", 1.2); sfx(tt + 0.2, "shimmer");
    tl.to("#cta", { scale: 1.05, duration: 0.5, ease: "sine.inOut", yoyo: true, repeat: 3 }, tt + 0.5);
    tl.fromTo("#fine", { opacity: 0 }, { opacity: 0.8, duration: 0.4 }, tc + 0.4);
    tl.to({}, { duration: 0.01 }, VO.total - 0.01);
  }

  window.__timelines["main"] = tl;
  tl.seek(0);
})();
