import { writeFileSync } from 'node:fs';
import { gable, gableInner } from './iter2.mjs';
import { f } from './geom.mjs';
import { fonts, layout } from './fonts.mjs';
const dir = new URL('../explorations/', import.meta.url).pathname;
const svg = (d, vb = '0 0 24 24') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}"><path fill-rule="evenodd" d="${d}"/></svg>`;
export const MARK = { cx: 12, cy: 13, R: 10, wall: 9, apex: 1.2, t: 4.6 };
export const mark = (o = {}) => { const m = { ...MARK, ...o }; return gable(m.cx, m.cy, m.R, m.wall, m.apex, 1.2, 1.4) + gableInner(m.cx, m.cy, m.R, m.wall, m.apex, m.t); };
const V = {
  'e1-mark-t44': mark({ t: 4.4 }),
  'e1-mark-t50-lowwall': mark({ t: 5, wall: 9.6, apex: 1.4 }),
  'e1-mark-t48': mark({ t: 4.8 }),
};
for (const [k, d] of Object.entries(V)) writeFileSync(dir + k + '.svg', svg(d));
// wordmark: first o replaced by the gabled o drawn at font scale
export function wordmarkPath(font, { tracking = -0.03, t = 0.27, size = 100 } = {}) {
  const L = layout(font, 'oiko', size, 0, 0, tracking);
  const b = L.glyphs[0].bbox; const s = (b.x2 - b.x1) / 20; const cx = (b.x1 + b.x2) / 2;
  const cy = b.y2 - 10 * s;
  const o = gable(cx, cy, 10 * s, cy - 4 * s, cy - 11.8 * s, 1.2 * s, 1.4 * s) + gableInner(cx, cy, 10 * s, cy - 4 * s, cy - 11.8 * s, t * 20 * s);
  const rest = L.glyphs.slice(1).map((g) => g.d).join('');
  const top = Math.min(cy - 11.8 * s, ...L.glyphs.slice(1).map((g) => g.bbox.y1));
  const bottom = Math.max(...L.glyphs.map((g) => g.bbox.y2));
  const right = L.glyphs[3].bbox.x2;
  return { d: o + rest, rest, o, x: b.x1, y: top, w: right - b.x1, h: bottom - top };
}
const it = await fonts.interTight(), ac = await fonts.acorn();
for (const [n, font, tr] of [['inter-tight', it, -0.035], ['acorn', ac, -0.02]]) {
  const w = wordmarkPath(font, { tracking: tr, t: n === 'acorn' ? 0.27 : 0.27 });
  writeFileSync(dir + `e1-wordmark-${n}.svg`, svg(w.d, `${f(w.x)} ${f(w.y)} ${f(w.w)} ${f(w.h)}`));
}
