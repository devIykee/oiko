// Loads the composition headlessly and prints the sound-effect cue list that film.js builds.
const { chromium } = require("playwright");
const { pathToFileURL } = require("node:url");
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  p.on("pageerror", (e) => console.error("PAGE ERROR", e.message));
  await p.goto(pathToFileURL(require("node:path").resolve(process.argv[2])).href);
  await p.waitForTimeout(1500);
  console.log(JSON.stringify(await p.evaluate(() => window.__sfx)));
  await b.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
