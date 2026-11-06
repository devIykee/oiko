// README check: every "do X → see Y" step in README.md's "Try it" section that carries an `[e2e: <test id>]` marker
// must point at a Playwright test whose title starts with that id (e2e/*.spec.ts). Steps without a marker are listed.
//   node --experimental-strip-types scripts/readme-check.ts      (or: pnpm readme-check)
// Marker forms: `[e2e: README-2]`, `[e2e: README-2, README-3]`, or with a title `[e2e: README-2 get paid …]` (only the id counts).
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const readme = readFileSync(process.argv[2] ?? join(ROOT, "README.md"), "utf8"); // optional path for testing

// The "Try it" section: from its heading to the next heading of the same or higher level.
const lines = readme.split(/\r?\n/);
const start = lines.findIndex((l) => /^#{1,6}\s+Try it\b/i.test(l));
if (start < 0) {
  console.error('readme-check: README.md has no "Try it" section');
  process.exit(1);
}
const level = /^(#+)/.exec(lines[start])![1].length;
let end = lines.length;
for (let i = start + 1; i < lines.length; i++) {
  const m = /^(#+)\s/.exec(lines[i]);
  if (m && m[1].length <= level) { end = i; break; }
}
const section = lines.slice(start + 1, end).map((text, i) => ({ text, line: start + 2 + i }));

// Test ids defined in e2e/: the leading token of each test title, e.g. test("README-4 a locked pot …").
const ids = new Set<string>();
for (const f of readdirSync(join(ROOT, "e2e")).filter((f) => /\.(spec|test)\.[cm]?[jt]s$/.test(f))) {
  const src = readFileSync(join(ROOT, "e2e", f), "utf8");
  for (const m of src.matchAll(/\btest(?:\.(?:only|skip|fixme|slow))?\(\s*["'`]([A-Za-z]+-\d+)\b/g)) ids.add(m[1]);
}

const steps = section.filter((l) => /^\s*(\d+[.)]|[-*])\s+/.test(l.text) && /→|->/.test(l.text));
let missing = 0, marked = 0;
for (const s of section) {
  for (const m of s.text.matchAll(/\[e2e:\s*([^\]]+)\]/g)) {
    for (const ref of m[1].split(/[,;]/)) {
      const id = /^\s*([A-Za-z]+-\d+)/.exec(ref)?.[1];
      if (!id) { console.error(`README.md:${s.line}: unreadable marker "[e2e: ${m[1]}]"`); missing++; continue; }
      marked++;
      if (!ids.has(id)) { console.error(`README.md:${s.line}: [e2e: ${id}] has no matching test in e2e/ (known: ${[...ids].sort().join(", ")})`); missing++; }
    }
  }
}
const unmarked = steps.filter((s) => !/\[e2e:/.test(s.text));
for (const s of unmarked) console.log(`note: README.md:${s.line}: step has no [e2e: …] marker: ${s.text.trim().slice(0, 90)}`);
console.log(`readme-check: ${steps.length} steps in "Try it", ${marked} e2e references, ${missing} broken; ${ids.size} test ids in e2e/`);
process.exit(missing ? 1 : 0);
