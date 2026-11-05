import { readFileSync, writeFileSync } from "node:fs";
const D = process.argv[2], OUT = process.argv[3];
const pick = { 
  tron: "networks/branded/tron", base: "networks/branded/base", bsc: "networks/branded/binance-smart-chain",
  eth: "networks/branded/ethereum", sol: "networks/branded/solana", arb: "networks/branded/arbitrum-one",
  pol: "networks/branded/polygon", near: "networks/branded/near-protocol",
  usdc: "tokens/background/USDC", usdt: "tokens/background/USDT",
};
const lines = [];
for (const [k, f] of Object.entries(pick)) {
  const js = readFileSync(`${D}/${f}.svg.js`, "utf8");
  const m = js.match(/'(<svg[\s\S]*<\/svg>)\\n'/);
  let inner = m[1].replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "").replace(/\\n\s*/g, "").trim();
  // make ids instance-scoped: id="x__a" -> id="{{id}}x__a", url(#x__a) -> url(#{{id}}x__a)
  inner = inner.replace(/id="([^"]+)"/g, 'id="{{id}}$1"').replace(/url\(#([^)]+)\)/g, "url(#{{id}}$1)");
  lines.push(`  ${k}: ${JSON.stringify(inner)},`);
}
writeFileSync(OUT, `// GENERATED from @web3icons/core@4.0.58 (MIT, (c) 0xa3k5, https://github.com/0xa3k5/web3icons).
// Official brand marks, copied verbatim from dist/svgs (networks/branded, tokens/background); not redrawn.
// "{{id}}" is replaced per instance so gradient/clip ids stay unique on a page.
// Regenerate: npm pack @web3icons/core@4.0.58, extract, then\n// node scripts/gen-logos.mjs <extracted>/package/dist/svgs src/components/logoData.ts
export const LOGO_SVG = {
${lines.join("\n")}
} as const;
`);
