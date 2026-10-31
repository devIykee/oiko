// Generates the three exploration concepts + 16px variants + a contact sheet.
import { writeFileSync } from 'node:fs';
import { circle, peaked, rrect, f } from './geom.mjs';
import { renderSvg } from './render.mjs';
import { fonts, layout } from './fonts.mjs';
const dir = new URL('../explorations/', import.meta.url).pathname;
const svg = (d, extra = '', vb = '0 0 24 24') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}"><path fill-rule="evenodd" d="${d}"/>${extra}</svg>`;

// A: thick ring "o" whose top rises into a roof peak; round counter sits low (a coin in a house).
const A = (o = {}) => { const { R = 9.6, cy = 13.8, roof = 96, rr = 1.3, cr = 4.4, ccy = 14.6 } = o; return peaked(12, cy, R, roof, rr) + circle(12, ccy, cr, true); };
// B: rounded-square tile, knocked-out roof chevron over a coin dot.
const chev = (cx, top, half, drop, w) => { // thick chevron polygon: apex at (cx,top), legs to (cx±half, top+drop), stroke width w (vertical thickness)
  return `M${f(cx)} ${f(top)}L${f(cx + half)} ${f(top + drop)}L${f(cx + half)} ${f(top + drop + w)}L${f(cx)} ${f(top + w)}L${f(cx - half)} ${f(top + drop + w)}L${f(cx - half)} ${f(top + drop)}Z`; };
const B = (o = {}) => { const { w = 3.2, dot = 2.6 } = o; return rrect(1, 1, 22, 22, 6.5) + chev(12, 5.6, 6.6, 5.4, w) + circle(12, 15.9, dot, true); };
// C: a plain round "o" whose counter is a small house (the home is inside the o).
const house = (cx, top, hw, wallTop, bottom) => `M${f(cx)} ${f(top)}L${f(cx + hw)} ${f(wallTop)}V${f(bottom)}H${f(cx - hw)}V${f(wallTop)}Z`;
const C = (o = {}) => { const { R = 10.5, hw = 4.2, top = 6.6, wall = 10.8, bottom = 16.6 } = o; return circle(12, 12, R) + house(12, top, hw, wall, bottom); };

const concepts = {
  'a-roof-ring': { d: A(), d16: A({ cr: 4.6, rr: 0.8 }) },
  'b-tile-roof-coin': { d: B(), d16: B({ w: 3.6, dot: 3 }) },
  'c-home-in-the-o': { d: C(), d16: C({ hw: 4.6, top: 5.8, wall: 10.4, bottom: 17.2 }) },
};
for (const [k, v] of Object.entries(concepts)) {
  writeFileSync(dir + k + '.svg', svg(v.d));
  writeFileSync(dir + k + '-16.svg', svg(v.d16));
}
// wordmark samples with both candidate faces
const it = await fonts.interTight(), ac = await fonts.acorn();
function wordmark(font, name, mark, tracking) {
  const L = layout(font, 'oiko', 100, 0, 0, tracking);
  const o = L.glyphs[0].bbox; const h = o.y2 - o.y1; // replace first o by the mark: mark circle diameter = o height
  const s = h / 19.2; // A circle diameter 19.2
  const rest = L.glyphs.slice(1).map((g) => g.d).join('');
  const markT = `<path fill-rule="evenodd" transform="translate(${f(o.x1 + (o.x2 - o.x1) / 2 - 12 * s)} ${f(o.y1 - 4.2 * s)}) scale(${f(s)})" d="${mark}"/>`;
  const w = L.width + 4;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -82 ${f(w)} 90"><path d="${rest}"/>${markT}</svg>`;
}
for (const [fn, font, tr] of [['inter-tight', it, -0.03], ['acorn', ac, -0.02]]) {
  writeFileSync(dir + `wordmark-a-${fn}.svg`, wordmark(font, fn, A(), tr));
  writeFileSync(dir + `wordmark-c-${fn}.svg`, wordmark(font, fn, C(), tr).replace('o.y1 - 4.2', ''));
  writeFileSync(dir + `wordmark-plain-${fn}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -82 ${f(layout(font, 'oiko', 100, 0, 0, tr).width + 4)} 90"><path d="${layout(font, 'oiko', 100, 0, 0, tr).d}"/></svg>`);
}
