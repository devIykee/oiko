import { writeFileSync } from 'node:fs';
import { circle, f } from './geom.mjs';
const dir = new URL('../explorations/', import.meta.url).pathname;
const svg = (d) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill-rule="evenodd" d="${d}"/></svg>`;
const P = (x, y) => `${f(x)} ${f(y)}`;
// Gabled o: semicircle base (cx,cy,R), vertical walls up to wallTop, roof to apex. Apex & eave corners rounded (rA, rE).
export function gable(cx, cy, R, wallTop, apexY, rA = 1, rE = 1, ccw = false) {
  const run = R, rise = wallTop - apexY; const L = Math.hypot(run, rise);
  const ux = run / L, uy = rise / L; // unit vector apex -> right eave
  const a1 = [cx - ux * rA, apexY + uy * rA], a2 = [cx + ux * rA, apexY + uy * rA];
  const eR1 = [cx + R - ux * rE, wallTop - uy * rE], eR2 = [cx + R, wallTop + rE];
  const eL1 = [cx - R, wallTop + rE], eL2 = [cx - R + ux * rE, wallTop - uy * rE];
  if (!ccw) return `M${P(...a1)}Q${P(cx, apexY)} ${P(...a2)}L${P(...eR1)}Q${P(cx + R, wallTop)} ${P(...eR2)}V${f(cy)}A${f(R)} ${f(R)} 0 0 1 ${P(cx - R, cy)}V${f(eL1[1])}Q${P(cx - R, wallTop)} ${P(...eL2)}Z`;
  return `M${P(...a2)}Q${P(cx, apexY)} ${P(...a1)}L${P(...eL2)}Q${P(cx - R, wallTop)} ${P(...eL1)}V${f(cy)}A${f(R)} ${f(R)} 0 0 0 ${P(cx + R, cy)}V${f(eR2[1])}Q${P(cx + R, wallTop)} ${P(...eR1)}Z`;
}
// inner offset of a gable by t
export function gableInner(cx, cy, R, wallTop, apexY, t, rA = 0.6, rE = 0.6) {
  const run = R, rise = wallTop - apexY; const cos = run / Math.hypot(run, rise); const m = rise / run;
  const iApex = apexY + t / cos; const iR = R - t; const iWall = iApex + m * iR;
  return gable(cx, cy, iR, Math.min(iWall, cy), iApex, rA, rE, true);
}
const V = {
  'd1-gable-o-coin': gable(12, 13, 10, 9, 1.2, 1.2, 1.4) + circle(12, 13.6, 4.4, true),
  'd2-gable-o-mono': gable(12, 13, 10, 9, 1.2, 1.2, 1.4) + gableInner(12, 13, 10, 9, 1.2, 4.6),
  'd3-gable-o-mono-steep': gable(12, 13.5, 9.5, 8.6, 0.8, 1.2, 1.4) + gableInner(12, 13.5, 9.5, 8.6, 0.8, 4.5),
  'd4-gable-o-coin-low': gable(12, 13, 10, 8, 1.6, 1.4, 1.6) + circle(12, 13.4, 4.6, true),
};
for (const [k, d] of Object.entries(V)) writeFileSync(dir + k + '.svg', svg(d));
