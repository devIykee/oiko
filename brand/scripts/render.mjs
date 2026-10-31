// Render an SVG file to PNGs at given sizes. usage: node render.mjs file.svg outPrefix [bg] [sizes]
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'node:fs';
export function renderSvg(svg, size, bg) {
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: size }, background: bg });
  return r.render().asPng();
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const [, , file, out, bg = 'white', sizes = '16,32,64,256,1024'] = process.argv;
  const svg = readFileSync(file, 'utf8');
  for (const s of sizes.split(',').map(Number)) writeFileSync(`${out}-${s}.png`, renderSvg(svg, s, bg === 'none' ? undefined : bg));
}
