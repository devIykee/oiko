// Contact sheet: for each svg -> real PNG renders at 16/32/64/256 (and files on disk), upscaled pixelated so we can judge small sizes.
import { readFileSync, writeFileSync } from 'node:fs';
import { renderSvg } from './render.mjs';
export function sheet(files, out, { sizes = [16, 32, 64, 256], fg = '#16181D', bg = '#FFFFFF', save = null } = {}) {
  let y = 20, items = '';
  for (const file of files) {
    let svg = readFileSync(file, 'utf8').replace('<svg ', `<svg fill="${fg}" `);
    let x = 20;
    for (const s of sizes) {
      const png = renderSvg(svg, s, bg);
      if (save) writeFileSync(`${save}/${file.split('/').pop().replace('.svg', '')}-${s}.png`, png);
      const disp = s <= 32 ? s * 4 : s <= 64 ? s * 2 : s;
      items += `<image x="${x}" y="${y}" width="${disp}" height="${disp}" image-rendering="optimizeSpeed" href="data:image/png;base64,${png.toString('base64')}"/>`;
      // also true size thumbnail below
      if (s <= 32) items += `<image x="${x}" y="${y + disp + 6}" width="${s}" height="${s}" href="data:image/png;base64,${png.toString('base64')}"/>`;
      x += disp + 24;
    }
    y += 290;
  }
  const W = 20 + sizes.reduce((a, s) => a + (s <= 32 ? s * 4 : s <= 64 ? s * 2 : s) + 24, 0);
  const doc = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${y}"><rect width="100%" height="100%" fill="${bg}"/>${items}</svg>`;
  writeFileSync(out, renderSvg(doc, W, bg));
}
if (process.argv[1] === new URL(import.meta.url).pathname) { const [, , out, fg, bg, ...files] = process.argv; sheet(files, out, { fg, bg }); }
