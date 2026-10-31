#!/usr/bin/env node
// Banned-words test for user-facing strings.
// Scope A (all user-facing UI incl. landing): dollar(s), standalone USD, "$" before a digit.
// Scope B (product app screens + pay/start/connect + i18n tables): chain/crypto words.
// Only the stablecoin explainer sentence is exempt from scope A.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const WEB = join(ROOT, "apps/web");
const EXPLAINER = "USDC and USDT are stablecoins designed to track the US dollar. They are not dollars and are not bank deposits. They can lose their peg and issuers can freeze them.";
const EXPLAINER_FAQ = /Stablecoins track the US dollar but are not dollars or bank deposits|^Are these dollars\?$|^Stablecoins are not dollars\.$/;

const SCOPE_A = [/\bdollars?\b/i, /\bUSD\b/, /\$\s?\d/];
const SCOPE_B = [/\bgas\b/i, /seed phrase/i, /\bbridge\b/i, /\bnetwork\b/i, /\bRPC\b/, /chain ID/i, /wallet address/i,
  /\bmint(ed|ing)?\b/i, /\bwrap(ped)?\b/i, /\bcrypto\b/i, /\bweb3\b/i, /\bblockchain\b/i, /\bon-chain\b/i, /\bDeFi\b/,
  /\bwallets?\b/i, /\bvaults?\b/i, /\btokens?\b/i];

// Files whose strings are user-facing.
const A_DIRS = ["app", "components", "lib/i18n", "../../packages/ui/src"];
const B_DIRS = ["app/(app)", "app/pay", "app/start", "app/connect", "lib/i18n"];
const SKIP_FILES = /(\.test\.|fixtures|\/api\/|\/dev\/|opengraph|llms\.txt|well-known|route\.ts$)/;

function files(dir) {
  const out = [];
  const abs = join(WEB, dir);
  if (!existsSync(abs)) return out;
  (function walk(d) {
    for (const e of readdirSync(d)) {
      if (e === "node_modules" || e === ".next") continue;
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(tsx|ts|json)$/.test(e) && !SKIP_FILES.test(p)) out.push(p);
    }
  })(abs);
  return out;
}

// Extract user-visible text: JSX text nodes and string literals that look like prose (contain a space or start uppercase).
function strings(src) {
  const out = [];
  const noComments = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  for (const m of noComments.matchAll(/>([^<>{}`]+)</g)) if (/[A-Za-z]/.test(m[1])) out.push(m[1].trim());
  for (const m of noComments.matchAll(/(["'`])((?:\\.|(?!\1).)*)\1/g)) {
    const s = m[2];
    if (/\s/.test(s) && /[A-Za-z]{2}/.test(s) && !/^[\w./@:-]+$/.test(s) && !/className|^(flex|grid|text-|bg-|px-|py-)/.test(s)) out.push(s);
  }
  return out;
}

let bad = 0;
function check(list, patterns, label, exemptFile) {
  const seen = new Set();
  for (const f of list) {
    if (exemptFile && exemptFile(f)) continue;
    for (const s of strings(readFileSync(f, "utf8"))) {
      if (s.includes(EXPLAINER) || EXPLAINER_FAQ.test(s)) continue;
      if (/^(use client|use server)$/.test(s) || /className=|data-testid/.test(s)) continue;
      for (const re of patterns) {
        if (re.test(s.replace(/USD[CT]/g, "").replace(/https?:\/\/\S+/g, ""))) {
          const key = `${f}|${s}|${re}`;
          if (seen.has(key)) continue;
          seen.add(key);
          console.error(`[${label}] ${relative(ROOT, f)}: ${re} in "${s.slice(0, 110)}"`);
          bad++;
        }
      }
    }
  }
}

check(A_DIRS.flatMap(files), SCOPE_A, "no-dollar");
check(B_DIRS.flatMap(files), SCOPE_B, "product-words", (f) => /security|how-it-works/.test(f));
if (bad) { console.error(`check-copy: ${bad} banned string(s)`); process.exit(1); }
console.log("check-copy: ok");
