// Builds every Oiko brand export from source geometry. Run: node brand/scripts/build.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { optimize } from 'svgo';
import { mark } from './iter3.mjs';
import { wordmarkPath } from './iter3.mjs';
import { fonts, layout } from './fonts.mjs';
import { renderSvg } from './render.mjs';
import { f } from './geom.mjs';
const root = new URL('../../', import.meta.url).pathname;
const B = root + 'brand/', WEB = root + 'apps/web/';
mkdirSync(WEB + 'public/icons', { recursive: true });
const INK = '#16181D', BLUE = '#3D5AFE', WHITE = '#FFFFFF';
const opt = (s) => optimize(s, { multipass: true, floatPrecision: 2, plugins: ['preset-default'] }).data;
const save = (p, s) => { writeFileSync(p, opt(s)); return s; };

// ---- mark (24 grid). Final: gabled o, stroke 4.8, apex y 1.2, walls to y 9, round base r 10.
const MARK_D = mark({ t: 4.8 });
const markSvg = (fill) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="${fill}" fill-rule="evenodd" d="${MARK_D}"/></svg>`;
save(B + 'oiko-mark.svg', markSvg(INK));
save(B + 'oiko-mark-mono-dark.svg', markSvg('#000'));
save(B + 'oiko-mark-mono-light.svg', markSvg('#FFF'));

// ---- wordmark: Acorn Bold "oiko", first o replaced by the gabled o, outlines only.
const acorn = await fonts.acorn();
const W = wordmarkPath(acorn, { tracking: -0.025, t: 0.27 });
const wmVB = `${f(W.x)} ${f(W.y)} ${f(W.w)} ${f(W.h)}`;
const wmSvg = (fill) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${wmVB}"><path fill="${fill}" fill-rule="evenodd" d="${W.d}"/></svg>`;
save(B + 'oiko-wordmark.svg', wmSvg(INK));
save(B + 'oiko-wordmark-dark.svg', wmSvg('#F5F6F8'));

// ---- horizontal lockup: blue app tile + wordmark
const tileD = (x, y, s, r) => `M${x + r} ${y}h${s - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${s - 2 * r}a${r} ${r} 0 0 1 -${r} ${r}h-${s - 2 * r}a${r} ${r} 0 0 1 -${r} -${r}v-${s - 2 * r}a${r} ${r} 0 0 1 ${r} -${r}z`;
function lockup(ink, tile) {
  const h = W.h; // tile height equals wordmark height
  const gap = h * 0.28; const sc = (h * 0.62) / 24; const off = (h - 24 * sc) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(h + gap + W.w)} ${f(h)}"><path fill="${tile}" d="${tileD(0, 0, f(h), f(h * 0.26))}"/><path fill="#FFF" fill-rule="evenodd" transform="translate(${f(off)} ${f(off + 0.2 * sc)}) scale(${f(sc)})" d="${MARK_D}"/><path fill="${ink}" fill-rule="evenodd" transform="translate(${f(h + gap - W.x)} ${f(-W.y)})" d="${W.d}"/></svg>`;
}
save(B + 'oiko-lockup-horizontal.svg', lockup(INK, BLUE));
save(B + 'oiko-lockup-horizontal-dark.svg', lockup('#F5F6F8', '#6E86FF'));

// ---- app icon (full bleed blue, white mark inside the maskable safe zone: 80% circle)
const appIcon = (scale, rounded = 0) => {
  const S = 512, s = scale, o = (S - 24 * s) / 2;
  const bg = rounded ? `<path fill="${BLUE}" d="${tileD(0, 0, S, rounded)}"/>` : `<path fill="${BLUE}" d="M0 0h${S}v${S}H0z"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}">${bg}<path fill="#FFF" fill-rule="evenodd" transform="translate(${f(o)} ${f(o - 0.1 * s)}) scale(${s})" d="${MARK_D}"/></svg>`;
};
const maskable = save(B + 'oiko-app-icon.svg', appIcon(12));
const regular = appIcon(13.5);
const favicon = appIcon(15, 112); // rounded tile for browser tabs
save(WEB + 'app/icon.svg', favicon);
const png = (svg, size, bg) => renderSvg(svg, size, bg);
writeFileSync(WEB + 'app/apple-icon.png', png(regular, 180));
writeFileSync(WEB + 'public/icons/icon-192.png', png(regular, 192));
writeFileSync(WEB + 'public/icons/icon-512.png', png(regular, 512));
writeFileSync(WEB + 'public/icons/icon-512-maskable.png', png(maskable, 512));
// favicon.ico (PNG-in-ICO, 16/32/48)
const sizes = [16, 32, 48]; const imgs = sizes.map((s) => png(favicon, s));
const head = Buffer.alloc(6 + 16 * sizes.length); head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
let off = head.length;
sizes.forEach((s, i) => { const e = 6 + 16 * i; head.writeUInt8(s, e); head.writeUInt8(s, e + 1); head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6); head.writeUInt32LE(imgs[i].length, e + 8); head.writeUInt32LE(off, e + 12); off += imgs[i].length; });
writeFileSync(WEB + 'app/favicon.ico', Buffer.concat([head, ...imgs]));

// ---- renders for review
for (const [n, svg, bg] of [['mark', markSvg(INK), WHITE], ['mark-light', markSvg('#FFF'), '#0B0C0E'], ['app-icon', regular, undefined], ['favicon', favicon, undefined]])
  for (const s of [16, 32, 64, 256, 1024]) writeFileSync(`${B}renders/final-${n}-${s}.png`, png(svg, s, bg));
writeFileSync(B + 'renders/final-wordmark-800.png', png(wmSvg(INK), 800, WHITE));
writeFileSync(B + 'renders/final-lockup-800.png', png(lockup(INK, BLUE), 800, WHITE));
writeFileSync(B + 'renders/final-lockup-dark-800.png', png(lockup('#F5F6F8', '#6E86FF'), 800, '#0B0C0E'));

// ---- OpenGraph 1200x630: flat light canvas, lockup, headline in Acorn, sub in Inter, blue panel with mark.
const inter = await fonts.inter();
const line = (font, text, size, x, y, tr) => layout(font, text, size, x, y, tr).d;
const lk = lockup(INK, BLUE); const lkInner = lk.replace(/^<svg[^>]*>/, '').replace('</svg>', '');
const lkScale = 56 / W.h;
const og = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<rect width="1200" height="630" fill="#F4F5F7"/>
<rect x="800" width="400" height="630" fill="${BLUE}"/>
<path fill="#FFF" fill-rule="evenodd" transform="translate(880 195) scale(10)" d="${MARK_D}"/>
<g transform="translate(80 72) scale(${f(lkScale)})">${lkInner}</g>
<path fill="${INK}" d="${line(acorn, 'Personal finance', 72, 80, 318, -0.02)}${line(acorn, 'meets personal', 72, 80, 400, -0.02)}${line(acorn, 'intelligence.', 72, 80, 482, -0.02)}"/>
<path fill="#5E636E" d="${line(inter, 'Plan every bit. Your own AI agent helps,', 26, 80, 548, -0.005)}${line(inter, 'on limits you set.', 26, 80, 584, -0.005)}"/>
</svg>`;
writeFileSync(WEB + 'app/opengraph-image.png', png(og, 1200));
writeFileSync(WEB + 'app/opengraph-image.alt.txt', 'Oiko: Personal finance meets personal intelligence. Plan every bit. Your own AI agent helps, on limits you set.');
writeFileSync(B + 'renders/og.png', png(og, 1200));

// ---- React component data
const opts = (s) => opt(s).match(/ d="([^"]+)"/)[1];
const markOpt = opts(markSvg('#000'));
const wmOpt = opts(wmSvg('#000'));
writeFileSync(WEB + 'components/brand/paths.ts', `// AUTO-GENERATED by brand/scripts/build.mjs. Do not edit by hand.
export const MARK_PATH = ${JSON.stringify(markOpt)};
export const MARK_VIEWBOX = "0 0 24 24";
export const WORDMARK_PATH = ${JSON.stringify(wmOpt)};
export const WORDMARK_VIEWBOX = ${JSON.stringify(wmVB)};
export const WORDMARK_RATIO = ${f(W.w / W.h)};
`);
console.log('mark bytes', Buffer.byteLength(opt(markSvg(INK))), 'wordmark bytes', Buffer.byteLength(opt(wmSvg(INK))));
