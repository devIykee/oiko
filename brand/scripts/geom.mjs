// Shared geometry helpers for the Oiko mark. All coordinates on a 24-unit grid.
export const f = (n) => +n.toFixed(2);
export function circle(cx, cy, r, ccw = false) {
  // full circle as two arcs; ccw flips sweep so evenodd/nonzero both work
  const s = ccw ? 0 : 1;
  return `M${f(cx - r)} ${f(cy)}A${f(r)} ${f(r)} 0 1 ${s} ${f(cx + r)} ${f(cy)}A${f(r)} ${f(r)} 0 1 ${s} ${f(cx - r)} ${f(cy)}Z`;
}
// Peaked ring outer: circle (cx,cy,R) with tangent lines meeting at an apex above, apex rounded with radius rr.
export function peaked(cx, cy, R, roofDeg, rr = 0, ccw = false) {
  const a = (roofDeg / 2) * Math.PI / 180; // half apex angle
  const d = R / Math.sin(a);
  const ax = cx, ay = cy - d;
  const t = Math.PI / 2 - a; // angle from vertical to tangent point at centre
  const lx = cx - R * Math.sin(t), rx = cx + R * Math.sin(t), ty = cy - R * Math.cos(t);
  const L = Math.hypot(rx - ax, ty - ay);
  const k = rr / L;
  const p1 = [ax + (lx - ax) * k, ay + (ty - ay) * k];
  const p2 = [ax + (rx - ax) * k, ay + (ty - ay) * k];
  if (!ccw)
    return `M${f(p1[0])} ${f(p1[1])}Q${f(ax)} ${f(ay)} ${f(p2[0])} ${f(p2[1])}L${f(rx)} ${f(ty)}A${f(R)} ${f(R)} 0 1 1 ${f(lx)} ${f(ty)}Z`;
  return `M${f(p2[0])} ${f(p2[1])}Q${f(ax)} ${f(ay)} ${f(p1[0])} ${f(p1[1])}L${f(lx)} ${f(ty)}A${f(R)} ${f(R)} 0 1 0 ${f(rx)} ${f(ty)}Z`;
}
export function apexOf(cx, cy, R, roofDeg) {
  const a = (roofDeg / 2) * Math.PI / 180;
  return cy - R / Math.sin(a);
}
export function rrect(x, y, w, h, r) {
  return `M${f(x + r)} ${f(y)}H${f(x + w - r)}A${r} ${r} 0 0 1 ${f(x + w)} ${f(y + r)}V${f(y + h - r)}A${r} ${r} 0 0 1 ${f(x + w - r)} ${f(y + h)}H${f(x + r)}A${r} ${r} 0 0 1 ${f(x)} ${f(y + h - r)}V${f(y + r)}A${r} ${r} 0 0 1 ${f(x + r)} ${f(y)}Z`;
}
