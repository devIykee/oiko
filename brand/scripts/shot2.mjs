// viewport shots while scrolling through a selector: node shot2.mjs url outPrefix width scheme selector offsets(px,comma) motion
import { chromium } from '@playwright/test';
const [,, url, out, width, scheme, sel, offs, motion = 'no-preference'] = process.argv;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: +width, height: 860 }, colorScheme: scheme, reducedMotion: motion });
await p.goto(url, { waitUntil: 'load' });
await p.waitForTimeout(2000);
const top = await p.evaluate((s) => document.querySelector(s).getBoundingClientRect().top + scrollY, sel);
let i = 0;
for (const o of offs.split(',').map(Number)) {
  await p.evaluate((y) => window.scrollTo(0, y), top + o);
  await p.waitForTimeout(700);
  await p.screenshot({ path: `${out}-${i++}.png` });
}
await b.close();
