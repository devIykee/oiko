#!/usr/bin/env node
// Fails if an LLM SDK or LLM API host appears in apps/, services/ or packages/ (Oiko ships no built-in AI).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["apps", "services", "packages"];
const SKIP = new Set(["node_modules", ".next", "dist", "target", ".vercel", "coverage"]);
const BANNED = [
  /["'`](openai|@openai\/[\w-]+)["'`]/, /["'`]@anthropic-ai\/[\w-]+["'`]/, /["'`]@ai-sdk\/[\w-]+["'`]/,
  /["'`]ai["'`]\s*:/, /["'`](langchain|@langchain\/[\w-]+)["'`]/, /["'`]@google\/generative-ai["'`]/,
  /["'`]@google\/genai["'`]/, /["'`](cohere-ai|@mistralai\/[\w-]+|groq-sdk|ollama|replicate|together-ai)["'`]/,
  /api\.openai\.com/, /api\.anthropic\.com/, /generativelanguage\.googleapis\.com/, /api\.mistral\.ai/,
  /api\.groq\.com/, /api\.cohere\.(ai|com)/, /openrouter\.ai\/api/, /api\.x\.ai/, /api\.together\.xyz/,
  /api\.deepseek\.com/, /ai-gateway\.vercel\.sh/, /cloud-api\.near\.ai/,
];
const EXT = /\.(m?[jt]sx?|json|ya?ml|toml|env\.example)$/;
const hits = [];
function walk(dir) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const e of entries) {
    if (SKIP.has(e)) continue;
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) walk(p);
    else if (EXT.test(e)) {
      const text = readFileSync(p, "utf8");
      text.split("\n").forEach((line, i) => {
        for (const re of BANNED) if (re.test(line)) hits.push(`${p}:${i + 1}: ${line.trim().slice(0, 120)}`);
      });
    }
  }
}
ROOTS.forEach(walk);
if (hits.length) {
  console.error("LLM SDK or LLM API host found (Oiko has no built-in AI):\n" + hits.join("\n"));
  process.exit(1);
}
console.log("check-no-llm: ok (no LLM SDKs or LLM API hosts in apps/, services/, packages/)");
