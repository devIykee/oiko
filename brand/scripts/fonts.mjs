import opentype from 'opentype.js';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const wawoff2 = require('wawoff2');
const root = new URL('../../', import.meta.url).pathname;
async function load(path) {
  let buf = readFileSync(path);
  if (path.endsWith('.woff2')) buf = Buffer.from(await wawoff2.decompress(buf));
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}
export const fonts = {
  interTight: () => load(root + 'node_modules/@fontsource/inter-tight/files/inter-tight-latin-700-normal.woff'),
  interTight600: () => load(root + 'node_modules/@fontsource/inter-tight/files/inter-tight-latin-600-normal.woff'),
  acorn: () => load(root + 'fonts/Acorn-Bold.woff2'),
  inter: () => load(root + 'node_modules/@fontsource/inter/files/inter-latin-400-normal.woff'),
  acornSemi: () => load(root + 'fonts/Acorn-SemiBold.woff2'),
};
// Lay out text as individual glyph paths; tracking in em units (e.g. -0.03). Returns {d, width, glyphs:[{d,x,adv,bbox}]}
export function layout(font, text, size, x = 0, y = 0, tracking = 0) {
  const scale = size / font.unitsPerEm;
  const glyphs = [...text].map((c) => font.charToGlyph(c));
  let cx = x; const out = [];
  for (let i = 0; i < glyphs.length; i++) {
    const g = glyphs[i];
    const p = g.getPath(cx, y, size);
    out.push({ d: p.toPathData(2), x: cx, adv: g.advanceWidth * scale, bbox: p.getBoundingBox() });
    let kern = 0;
    if (i < glyphs.length - 1) kern = font.getKerningValue(g, glyphs[i + 1]) * scale;
    cx += g.advanceWidth * scale + kern + tracking * size;
  }
  return { glyphs: out, d: out.map((g) => g.d).join(''), width: cx - x - tracking * size };
}
