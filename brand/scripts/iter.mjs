import { writeFileSync } from 'node:fs';
import { circle, f } from './geom.mjs';
const dir = new URL('../explorations/', import.meta.url).pathname;
const svg = (d) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill-rule="evenodd" d="${d}"/></svg>`;
// Ring + roof with eaves, unioned analytically.
// circle (cx,cy,R); roof apex outer at (cx, ay); slope deg from horizontal; eave tip at x = cx ± ew; roof thickness t (perpendicular); counter circle (ccy, cr)
export function roofRing({ cx = 12, cy = 14.2, R = 8.8, ay = 1.2, slope = 38, ew = 11, t = 3.6, ccy = 14.6, cr = 4.2, tipR = 0.9, eaveCut = 'vertical' }) {
  const m = Math.tan(slope * Math.PI / 180);
  const tv = t / Math.cos(slope * Math.PI / 180); // vertical thickness
  const yOut = (u) => ay + m * u; // outer line at offset u from centre
  const b0 = ay + tv - cy; // underside: y - cy = m u + b0
  // intersect underside with circle: u^2 + (m u + b0)^2 = R^2
  const A = 1 + m * m, B = 2 * m * b0, C = b0 * b0 - R * R;
  const u = (-B + Math.sqrt(B * B - 4 * A * C)) / (2 * A);
  const iy = cy + m * u + b0;
  const tipTop = yOut(ew), tipBot = tipTop + tv;
  // rounded apex: back off along the roof by tipR
  const k = tipR / Math.hypot(1, m);
  const P = (x, y) => `${f(x)} ${f(y)}`;
  const d = `M${P(cx - k, ay + m * k)}Q${P(cx, ay)} ${P(cx + k, ay + m * k)}L${P(cx + ew, tipTop)}L${P(cx + ew, tipBot)}L${P(cx + u, iy)}A${f(R)} ${f(R)} 0 1 1 ${P(cx - u, iy)}L${P(cx - ew, tipBot)}L${P(cx - ew, tipTop)}Z`;
  return d + circle(cx, ccy, cr, true);
}
export function homeO({ R = 10.5, hw = 4.1, top = 6.2, wall = 10.2, bottom = 16.4, cy = 12 }) {
  return circle(12, cy, R) + `M12 ${f(top)}L${f(12 + hw)} ${f(wall)}V${f(bottom)}H${f(12 - hw)}V${f(wall)}Z`;
}
const v = {
  'a2-roof-eaves-38': roofRing({}),
  'a2-roof-eaves-45': roofRing({ slope: 45, ay: 0.6, R: 8.6, cy: 14.6, ccy: 15, cr: 4, ew: 10.6 }),
  'a2-roof-eaves-32-thin': roofRing({ slope: 32, ay: 2.4, R: 9, cy: 14.4, ccy: 14.6, cr: 4.6, t: 3.2, ew: 11.4 }),
  'c2-home-o-letter': homeO({ R: 10.5, hw: 4.3, top: 5.2, wall: 9.4, bottom: 15.9 }),
  'c2-home-o-tall': homeO({ R: 10.5, hw: 3.9, top: 4.6, wall: 8.7, bottom: 16.2 }),
};
for (const [k, d] of Object.entries(v)) writeFileSync(dir + k + '.svg', svg(d));
