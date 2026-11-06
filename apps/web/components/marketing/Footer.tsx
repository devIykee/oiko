import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { FooterContracts } from "./FooterContracts";
import { ThemeSwitch } from "./ThemeSwitch";
import { Container } from "./ui";

export const REPO = "https://github.com/devIykee/oiko";

const cols: Array<{ title: string; links: Array<[string, string]> }> = [
  { title: "Product", links: [["Open app", "/home"], ["Get your name", "/start"], ["How it works", "/how-it-works"], ["Plan", "/#plan"], ["Savings and locks", "/#savings"]] },
  { title: "Agents and developers", links: [["Agent docs", "/docs/agents"], ["Connect your agent", "/agents"], ["oiko-agent.json", "/.well-known/oiko-agent.json"], ["llms.txt", "/llms.txt"], ["GitHub", REPO]] },
  { title: "Security", links: [["Trust and security", "/security"], ["Locks", "/security#locks"], ["Agent limits", "/security#agents"], ["Risks", "/security#risks"]] },
  { title: "Legal", links: [["Licence (MIT)", `${REPO}/blob/main/LICENSE`], ["Risks in plain words", "/security#risks"], ["Contact", "mailto:eokorie1944@gmail.com"]] },
];

export function Footer() {
  return (
    <footer className="bg-surface pb-10 pt-20 text-ink">
      <Container>
        <div className="grid gap-12 lg:grid-cols-[1.2fr_2fr]">
          <div>
            <Logo variant="wordmark" height={34} />
            <p className="mt-5 max-w-[320px] text-[20px] font-semibold leading-snug tracking-[-0.02em] font-display">Personal finance meets personal intelligence.</p>
            <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-[14px] text-ink-2">
              <a href="mailto:eokorie1944@gmail.com" className="hover:text-ink">eokorie1944@gmail.com</a>
              <a href={REPO} className="hover:text-ink" target="_blank" rel="noreferrer">GitHub</a>
            </div>
          </div>
          <nav aria-label="Footer" className="grid grid-cols-2 gap-x-6 gap-y-10 md:grid-cols-4">
            {cols.map((c) => (
              <div key={c.title}>
                <p className="text-[13px] font-semibold">{c.title}</p>
                <ul className="mt-3 space-y-2.5 text-[14px] text-ink-2">
                  {c.links.map(([l, h]) => (
                    <li key={l}>
                      {h.startsWith("http") || h.startsWith("mailto") || h.startsWith("/.well") || h === "/llms.txt" ? (
                        <a href={h} className="hover:text-ink" {...(h.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}>{l}</a>
                      ) : (
                        <Link href={h} prefetch={false} className="hover:text-ink">{l}</Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
        <div className="mt-14 grid gap-8 border-t border-line pt-8 md:grid-cols-[1fr_auto] md:items-start">
          <FooterContracts />
          <ThemeSwitch />
        </div>
        <p className="mt-8 max-w-[860px] text-[13px] leading-relaxed text-ink-2">
          Oiko is not a bank. Balances are not insured. Yields are variable and can go to zero. Stablecoins carry issuer risk. Not investment, legal or tax advice.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-[13px] text-ink-2">
          <span>© 2026 Oiko</span>
          <span>Open source under MIT</span>
        </div>
      </Container>
    </footer>
  );
}
