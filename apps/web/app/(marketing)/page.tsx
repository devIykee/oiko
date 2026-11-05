import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { AgentBudgetGlyph, AjoCircleGlyph, LockedPotGlyph, PayLinkGlyph } from "@/components/icons/custom";
import { AgentStory } from "@/components/marketing/AgentStory";
import { BeforeAfter } from "@/components/marketing/BeforeAfter";
import { CopyLine } from "@/components/marketing/CopyLine";
import { AgentDemo, PayByNameDemo, PlanDemo } from "@/components/marketing/demos";
import { Door } from "@/components/marketing/Door";
import { EarnCard } from "@/components/marketing/EarnCard";
import * as I from "@/components/marketing/f7";
import { Glyph } from "@/components/marketing/f7";
import { REPO } from "@/components/marketing/Footer";
import { NameClaim } from "@/components/marketing/NameClaim";
import { ActivityScreen, CapsScreen, ConsentScreen, HomeScreen, Phone, ProposalScreen } from "@/components/marketing/phone";
import { AssetLogo } from "@oiko/ui/logos";
import { Container, IconTile, PillLink, Section, SectionHeading, type TileColor } from "@/components/marketing/ui";

export const metadata: Metadata = {
  title: { absolute: "Oiko: Personal finance meets personal intelligence" },
  alternates: { canonical: "/" },
};

export default function Landing() {
  return (
    <>
      <Hero />
      <WhatItIs />
      <Section tone="grey" id="bills" labelledBy="ba-title">
        <SectionHeading id="ba-title" center title={<>Most money apps make you do the managing. Oiko does it the moment you get paid.</>} />
        <div className="mx-auto mt-14 max-w-[960px]"><BeforeAfter /></div>
      </Section>
      <Demo />
      <TrustCompare />
      <UseCases />
      <Agents />
      <Developers />
      <MoreInOiko />
      <Pillars />
      <Faq />
      <Closing />
    </>
  );
}

/* 3. Hero */
function Hero() {
  return (
    <section aria-labelledby="hero-title" className="relative -mt-16 overflow-hidden bg-bg pt-32 md:pt-40">
      <Container className="text-center">
        <h1 id="hero-title" className="mk-display mk-hero mx-auto max-w-[1000px]">
          <span className="mk-line" style={{ ["--i" as string]: 0 }}>Personal finance</span>
          <span className="mk-line" style={{ ["--i" as string]: 1 }}>meets personal intelligence.</span>
        </h1>
        <p className="mk-line mx-auto mt-7 max-w-[620px] text-[18px] leading-[1.55] text-ink-2 md:text-[21px]" style={{ ["--i" as string]: 2 }}>
          Get paid from anywhere. Plan every bit, pay your bills, save for what matters. Let your own AI agent help, on limits you set.
        </p>
        <div className="mk-line mt-10" style={{ ["--i" as string]: 3 }}>
          <NameClaim />
        </div>
        <div className="mk-line mt-4 flex justify-center" style={{ ["--i" as string]: 4 }}>
          <Link href="/how-it-works" className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[15px] font-semibold text-ink hover:bg-surface-2">
            See how it works <Glyph d={I.arrowRight} size={13} />
          </Link>
        </div>
      </Container>
      <div className="relative mx-auto mt-14 max-w-[1100px] px-4 md:mt-20">
        <div className="relative mx-auto h-[420px] w-fit overflow-hidden md:h-[500px]">
          <Phone label="The Oiko home screen: total balance, four round actions and pots for Spend, Bills, a laptop goal and a locked rainy-day fund">
            <HomeScreen />
          </Phone>
        </div>
        <FloatCard className="left-0 top-16 hidden md:flex xl:left-10" tile="mint" d={I.arrowDown} title="From Sam, 300.00 USDT" sub="Your plan ran: Bills, Savings, Laptop, Spend" />
        <FloatCard className="right-0 top-40 hidden md:flex xl:right-10" tile="stone" glyph={<LockedPotGlyph size={18} />} title="Rainy day, locked" sub="Opens 1 Jan 2027. Not before." />
        <a href="#what" className="absolute bottom-6 left-1/2 hidden -translate-x-1/2 translate-y-[calc(100%+40px)] items-center gap-1 text-[13px] text-ink-2 md:flex" aria-label="Scroll to the next section">
          <Glyph d={I.chevronDown} size={14} />
        </a>
      </div>
    </section>
  );
}

function FloatCard({ className, tile, d, glyph, title, sub }: { className?: string; tile: TileColor; d?: string; glyph?: ReactNode; title: string; sub: string }) {
  return (
    <div aria-hidden className={`absolute w-[280px] items-center gap-3 rounded-[20px] bg-surface p-3.5 shadow-[0_0_0_var(--hairline)_var(--line)] ${className}`}>
      <IconTile color={tile} d={d} size={40} solid>{glyph}</IconTile>
      <div className="min-w-0 text-left">
        <p className="truncate text-[14px] font-semibold">{title}</p>
        <p className="truncate text-[12px] text-ink-2">{sub}</p>
      </div>
    </div>
  );
}

/* 5. What it is */
function WhatItIs() {
  const cards: Array<{ title: string; body: string; icon: ReactNode; visual: ReactNode }> = [
    {
      title: "Get paid by name",
      body: "Claim your name and share one link. Clients, friends and family pay it from wherever their money is, and it lands in your account.",
      icon: <IconTile color="blue" size={44} solid><PayLinkGlyph size={22} /></IconTile>,
      visual: (
        <div className="rounded-[16px] bg-surface p-4">
          <p className="text-[12px] text-ink-2">Your pay link</p>
          <p className="mt-1 font-semibold">/pay/ada</p>
          <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] font-medium text-ink-2">
            {([["USDT on TRON", "tron"], ["USDC on Base", "base"], ["USDT on BNB", "bsc"]] as const).map(([s, c]) => <span key={s} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-surface-2 py-1 pl-1.5 pr-2.5"><AssetLogo chain={c} token={s.slice(0, 4)} size={20} />{s}</span>)}
          </div>
        </div>
      ),
    },
    {
      title: "A plan for every payment",
      body: "Bills, savings, goals and spending money. Every payment is split the moment it arrives, so payday sorts itself out.",
      icon: <IconTile color="violet" size={44} solid d={I.chartPieFill} />,
      visual: (
        <div className="rounded-[16px] bg-surface p-4">
          <div className="flex h-2.5 overflow-hidden rounded-full">
            <span className="w-[30%] bg-tile-sun" /><span className="w-[20%] bg-tile-mint" /><span className="w-[10%] bg-tile-violet" /><span className="w-[40%] bg-tile-blue" />
          </div>
          <p className="mt-3 text-[12px] leading-relaxed text-ink-2">If you get paid 100 USDT: 30 to Bills, 20 to Savings, 10 to Laptop, 40 to Spend.</p>
        </div>
      ),
    },
    {
      title: "An agent on a budget",
      body: "Connect the AI agent you already use. It can read, suggest or pay, but only up to your caps and only to people you allow.",
      icon: <IconTile color="mint" size={44} solid><AgentBudgetGlyph size={22} /></IconTile>,
      visual: (
        <div className="rounded-[16px] bg-surface p-4">
          <div className="flex justify-between text-[12px]"><span className="text-ink-2">This week</span><span className="font-semibold tabular">70 / 120 USDT</span></div>
          <div className="mt-2 h-1.5 rounded-full bg-surface-2"><div className="h-1.5 w-[58%] rounded-full bg-accent" /></div>
          <p className="mt-3 text-[12px] text-ink-2">3 allowed payees · expires 1 March</p>
        </div>
      ),
    },
  ];
  return (
    <Section tone="white" id="what" labelledBy="what-title">
      <SectionHeading id="what-title" title="One account that runs your money for you." lead="Oiko is a personal finance app. You get paid, Oiko sorts it, and the AI agent you trust can help, only inside the lines you draw." />
      <ul className="mk-stagger mt-14 grid gap-4 md:grid-cols-3">
        {cards.map((c, i) => (
          <li key={c.title} className="mk-hover-lift flex flex-col rounded-card bg-bg p-6 md:p-7" style={{ ["--i" as string]: i }}>
            {c.icon}
            <h3 className="mt-6 text-[24px] font-bold tracking-[-0.025em] font-display">{c.title}</h3>
            <p className="mt-2 text-[16px] text-ink-2">{c.body}</p>
            <div className="mt-auto pt-8">{c.visual}</div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/* 7. Live demo */
function Demo() {
  return (
    <Section tone="grey" id="demo" labelledBy="demo-title">
      <SectionHeading id="demo-title" center eyebrow="Try it right here" title="See it work before you sign up." lead="Three small tools built from the real app. Nothing here touches real money." />
      <div className="mt-14 grid items-stretch gap-4 lg:grid-cols-3">
        <PayByNameDemo />
        <div id="plan" className="scroll-mt-20 flex"><div className="flex w-full flex-col [&>*]:flex-1"><PlanDemo /></div></div>
        <AgentDemo />
      </div>
    </Section>
  );
}

/* 8. Trust comparison */
function TrustCompare() {
  const rows: Array<[string, string, string]> = [
    ["Who holds your money", "The company, in its own accounts", "You. Your account has no keys anyone else can use"],
    ["Can the company freeze or move it", "Yes, whenever it decides to", "No. Oiko has no admin key and the code cannot be changed"],
    ["Locked savings", "A setting someone can switch off", "Enforced by code. Not you, not Oiko, nobody opens it early"],
    ["Letting an AI help", "Share your password, or nothing", "A separate key with caps, payees and an expiry. Revoke in one tap"],
  ];
  return (
    <Section tone="ink" labelledBy="trust-title">
      <SectionHeading id="trust-title" title={<>Most apps hold your money.<br className="hidden md:block" /> Oiko gives it a home only you can open.</>} />
      <div className="mk-reveal mt-14 overflow-hidden rounded-card bg-[var(--mk-ink-surface)]">
        <div className="hidden grid-cols-[1fr_1fr_1.2fr] border-b border-[var(--mk-ink-line)] px-6 py-4 text-[13px] font-semibold text-[var(--mk-ink-text-2)] md:grid">
          <span />
          <span>A typical money app</span>
          <span className="text-[var(--mk-ink-text)]">An Oiko account</span>
        </div>
        <dl>
          {rows.map(([q, them, us]) => (
            <div key={q} className="grid gap-3 border-b border-[var(--mk-ink-line)] px-6 py-6 last:border-0 md:grid-cols-[1fr_1fr_1.2fr] md:gap-6">
              <dt className="text-[17px] font-semibold">{q}</dt>
              <dd className="flex gap-2 text-[15px] text-[var(--mk-ink-text-2)]"><Glyph d={I.xmarkCircleFill} size={16} className="mt-0.5 shrink-0 opacity-60" /><span><span className="sr-only">A typical money app: </span>{them}</span></dd>
              <dd className="flex gap-2 text-[15px]"><Glyph d={I.checkmarkCircleFill} size={16} className="mt-0.5 shrink-0 text-[#8C9EFF]" /><span><span className="sr-only">Oiko: </span>{us}</span></dd>
            </div>
          ))}
        </dl>
      </div>
    </Section>
  );
}

/* 9. Use cases */
function UseCases() {
  const cases: Array<{ title: string; body: string; color: TileColor; d?: string; glyph?: ReactNode }> = [
    { title: "Freelancer invoices, paid from anywhere", body: "Send a client an invoice link. They pay from wherever their money is, you see it marked Paid, and your accountant gets a clean CSV.", color: "blue", d: I.briefcaseFill },
    { title: "Monthly bills", body: "Your Bills pot fills every payday. Pay on the due day yourself, or let your bill payer agent do it.", color: "sun", d: I.docTextFill },
    { title: "Saving for a laptop", body: "A goal with a target and a date. Oiko shows when you will get there at your current pace.", color: "violet", d: I.deviceLaptop },
    { title: "A rainy-day fund", body: "Locked until the date you choose. On a bad day, nobody can open it early, not even you.", color: "stone", glyph: <LockedPotGlyph size={20} /> },
    { title: "ROSCA savings with friends", body: "Rotating savings where the order and contributions are enforced by code, not by trust in one organiser.", color: "mint", glyph: <AjoCircleGlyph size={20} /> },
    { title: "Family sending by name", body: "Your aunt pays ada, not a long account number. It arrives split by your plan.", color: "rose", d: I.person2Fill },
  ];
  return (
    <Section tone="white" labelledBy="uses-title">
      <SectionHeading id="uses-title" title="Made for the money in your actual life." />
      <ul className="mk-stagger mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cases.map((c, i) => (
          <li key={c.title} className="rounded-card bg-bg p-6 md:p-7" style={{ ["--i" as string]: i % 4 }}>
            <IconTile color={c.color} d={c.d} size={44} solid>{c.glyph}</IconTile>
            <h3 className="mt-5 text-[20px] font-bold tracking-[-0.02em] font-display">{c.title}</h3>
            <p className="mt-2 text-[15px] text-ink-2">{c.body}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/* 10. Agents deep-dive with the sticky scroll story */
function Agents() {
  return (
    <Section tone="grey" id="agents" labelledBy="agents-title">
      <SectionHeading id="agents-title" eyebrow="Agents" title="Give an AI a budget, not your keys." lead="Oiko has no built-in AI. Bring the agent you already use and decide exactly what it may do. Your account enforces it." />
      <div className="mk-reveal mt-8 flex flex-wrap gap-3">
        <PillLink href="/agents" variant="black" size="lg">Connect your agent</PillLink>
        <PillLink href="/docs/agents" variant="secondary" size="lg">Agent docs</PillLink>
      </div>
      <div className="mt-16 lg:mt-0">
        <AgentStory
          steps={[
            { kicker: "1 · Consent", title: "You say yes in plain words.", body: "Before anything connects you see what it can read, what it can do, how much and until when. Oiko warns you that it cannot verify who runs the agent.", screen: <ConsentScreen /> },
            { kicker: "2 · Limits", title: "Caps it cannot cross.", body: "Per payment, daily and weekly caps, and a list of who it may pay. Your account itself refuses anything outside them.", screen: <CapsScreen /> },
            { kicker: "3 · Proposals", title: "It asks before it acts.", body: "Give it suggest-only access and every idea waits for your Approve, with the agent’s reason in quotes.", screen: <ProposalScreen /> },
            { kicker: "4 · Activity", title: "Every action on the record.", body: "See what it read, what it paid and what was refused. Disconnect revokes its key immediately.", screen: <ActivityScreen /> },
          ]}
        />
      </div>
    </Section>
  );
}

/* 11. Developers */
function Developers() {
  const code = [
    ["k", "import"], ["t", " { gatewayAuthHeader } "], ["k", "from"], ["s", ' "@oiko/sdk"'], ["t", ";\n\n"],
    ["k", "const"], ["t", " path = "], ["s", '"/api/agent/overview"'], ["t", ";\n"],
    ["k", "const"], ["t", " auth = gatewayAuthHeader(\n  agentKey,\n  "], ["s", '"vault.ada.oiko.near"'], ["t", ",\n  "], ["s", '"GET"'], ["t", ", path, "], ["s", '""'], ["t", ",\n);\n\n"],
    ["k", "const"], ["t", " res = "], ["k", "await"], ["t", " fetch(oikoHost + path, {\n  headers: { Authorization: auth },\n});\n\n"],
    ["c", "// balances, pots, plan and bills,\n// each with a plain-English _help\n"],
    ["k", "const"], ["t", " overview = "], ["k", "await"], ["t", " res.json();"],
  ] as const;
  const color = { k: "text-[#A9B6FF]", s: "text-[#7EE0B5]", c: "text-[var(--mk-ink-text-2)]", t: "" } as const;
  return (
    <Section tone="ink" id="developers" labelledBy="dev-title">
      <SectionHeading id="dev-title" eyebrow={<span className="text-[#A9B6FF]">Developers</span>} title="Let any agent manage money safely." lead="One MCP server and a small signed REST API. Every request is checked against the limits the person set, by their own account." />
      <div className="mt-14 grid gap-10 lg:grid-cols-[1fr_1.15fr] lg:items-start">
        <div>
          <p className="mk-reveal text-[14px] font-semibold text-[var(--mk-ink-text-2)]">Run the MCP server</p>
          <div className="mk-reveal mt-3"><CopyLine text="npx @oiko/mcp" /></div>
          <ul className="mk-reveal mt-8 space-y-3 text-[15px]">
            {["MCP over stdio or streamable HTTP", "Every request signed with the agent’s own key (NEP-413)", "Caps, payees and expiry enforced by the person’s account", "Suggest-only mode: proposals wait for the person to approve"].map((t) => (
              <li key={t} className="flex gap-2.5"><Glyph d={I.checkmarkAlt} size={14} className="mt-1 shrink-0 text-[#A9B6FF]" />{t}</li>
            ))}
          </ul>
          <ul className="mk-reveal mt-8 flex flex-wrap gap-2 text-[14px] font-semibold">
            {[["Agent docs", "/docs/agents"], ["oiko-agent.json", "/.well-known/oiko-agent.json"], ["llms.txt", "/llms.txt"], ["GitHub", REPO]].map(([l, h]) => (
              <li key={l}>
                <a href={h} className="inline-flex h-10 items-center gap-1.5 rounded-full bg-[var(--mk-ink-surface)] px-4 hover:bg-[var(--mk-ink-line)]" {...(h.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}>
                  {l} <Glyph d={I.arrowUpRight} size={11} />
                </a>
              </li>
            ))}
          </ul>
        </div>
        <figure className="mk-reveal min-w-0 overflow-hidden rounded-card bg-[var(--mk-ink-surface)]">
          <figcaption className="flex items-center gap-2 border-b border-[var(--mk-ink-line)] px-5 py-3 text-[13px] text-[var(--mk-ink-text-2)]">
            <Glyph d={I.chevronLeftSlashChevronRight} size={14} /> agent.ts
          </figcaption>
          <pre className="overflow-x-auto p-5 text-[13px] leading-[1.7] md:text-[14px]"><code>{code.map(([k, t], i) => <span key={i} className={color[k]}>{t}</span>)}</code></pre>
        </figure>
      </div>
    </Section>
  );
}

/* 12. More in Oiko */
function MoreInOiko() {
  return (
    <Section tone="white" id="savings" labelledBy="more-title">
      <SectionHeading id="more-title" title="More in Oiko." />
      <ul className="mk-stagger mt-14 grid gap-4 md:grid-cols-3 [&>li]:bg-bg">
        <li className="flex flex-col rounded-card p-6 md:p-8" style={{ ["--i" as string]: 0 }}>
          <IconTile color="blue" size={44} solid d={I.chartBarFill} />
          <h3 className="mt-5 text-[22px] font-bold tracking-[-0.02em] font-display">Insights</h3>
          <p className="mt-2 text-[15px] text-ink-2">Money in, money out, what you saved and your savings rate, month by month. Your agent can read it too.</p>
        </li>
        <li className="flex flex-col rounded-card p-6 md:p-8" style={{ ["--i" as string]: 1 }}>
          <IconTile color="stone" size={44} solid><LockedPotGlyph size={22} /></IconTile>
          <h3 className="mt-5 text-[22px] font-bold tracking-[-0.02em] font-display">Goals and locks</h3>
          <p className="mt-2 text-[15px] text-ink-2">Name a goal, set a target, and lock it until a date if you want. A lock only the date can open.</p>
        </li>
        <EarnCard />
      </ul>
    </Section>
  );
}

/* 13. Trust pillars */
function Pillars() {
  const p: Array<{ t: string; b: string; d?: string; g?: ReactNode }> = [
    { t: "An account only you control", b: "Your money sits in your own account. Oiko cannot move it, freeze it or spend it.", d: I.lockShieldFill },
    { t: "Locks only the date can open", b: "Locked pots are enforced by code with no upgrade switch. Nobody can open them early.", g: <LockedPotGlyph size={22} /> },
    { t: "Agents inside your limits", b: "Agents get their own key with caps, payees and an expiry. Disconnect revokes it at once.", g: <AgentBudgetGlyph size={22} /> },
    { t: "Code you can check", b: "Open source, with the account code fingerprint published on the Trust page.", d: I.checkmarkShieldFill },
  ];
  return (
    <Section tone="grey" labelledBy="pillars-title">
      <SectionHeading id="pillars-title" title="Nobody in the middle." lead="No company sits between you and your money. Here is what that means in practice." />
      <ul className="mk-stagger mt-14 grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-4">
        {p.map((x, i) => (
          <li key={x.t} style={{ ["--i" as string]: i }}>
            <IconTile color="blue" size={48} d={x.d}>{x.g}</IconTile>
            <h3 className="mt-5 text-[19px] font-bold tracking-[-0.02em] font-display">{x.t}</h3>
            <p className="mt-2 text-[15px] text-ink-2">{x.b}</p>
          </li>
        ))}
      </ul>
      <div className="mk-reveal mt-12"><PillLink href="/security" variant="black">How we keep it safe <Glyph d={I.arrowRight} size={13} /></PillLink></div>
    </Section>
  );
}

/* 14. FAQ */
const FAQ: Array<[string, ReactNode]> = [
  ["Is Oiko a crypto app?", "Oiko is a personal finance app. Under the hood, your money is held as USDC and USDT stablecoins in an account on NEAR that only you control. Stablecoins track the US dollar but are not dollars or bank deposits, and they carry risks."],
  ["Is this a bank?", "No. Oiko is not a bank and your balance is not insured. It is software that runs an account only you control, with rules you set."],
  ["Are these dollars?", "No. USDC and USDT are stablecoins designed to track the US dollar. They are not dollars and are not bank deposits. They can lose their peg and issuers can freeze them."],
  ["Where does yield come from?", "Only if you switch on Earn for a pot. That pot is lent on Rhea, a lending market, and borrowers pay interest. The rate is variable, shown as today’s rate, and can go to zero. Before lending, your account checks the pool is not too busy, so you can usually take money back out. That is a safeguard, not a guarantee."],
  ["Can Oiko freeze my money?", "No. Oiko has no admin key to your account and its code cannot be upgraded. Locked pots open on their date and not before, for anyone, including you and us."],
  ["What if an issuer freezes funds?", "Circle (USDC) and Tether (USDT) can freeze their own stablecoins at any address. Oiko cannot prevent or undo that. It is a real risk of holding stablecoins."],
  ["Do you hold local currency?", "No. Oiko only holds USDC and USDT. There is no bank account and no local-currency balance."],
  ["What about regulation?", "Oiko is not a licensed financial service and does not hold your money for you. Rules differ by country, so check what applies where you live before using it with real money. Nothing here is investment, legal or tax advice."],
];
function Faq() {
  return (
    <Section tone="white" labelledBy="faq-title">
      <div className="grid gap-12 lg:grid-cols-[1fr_1.6fr]">
        <SectionHeading id="faq-title" title="Questions, answered plainly." />
        <div className="mk-reveal divide-y divide-line border-y border-line">
          {FAQ.map(([q, a]) => (
            <details key={q} className="mk-details group">
              <summary className="flex items-center justify-between gap-6 py-5 text-[18px] font-semibold tracking-[-0.01em] md:text-[20px]">
                {q}
                <span className="mk-chev flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-2"><Glyph d={I.chevronDown} size={13} /></span>
              </summary>
              <p className="max-w-[640px] pb-6 text-[16px] leading-relaxed text-ink-2">{a}</p>
            </details>
          ))}
        </div>
      </div>
    </Section>
  );
}

/* 16. Closing illustration */
function Closing() {
  return (
    <section aria-labelledby="close-title" className="bg-bg pt-24 md:pt-36">
      <Container className="text-center">
        <h2 id="close-title" className="mk-display mk-section-title mk-reveal mx-auto max-w-[760px]">Bring your money home.</h2>
        <div className="mk-reveal mt-8 flex flex-wrap justify-center gap-3">
          <PillLink href="/start" variant="accent" size="lg">Get your name</PillLink>
          <PillLink href="/home" variant="secondary" size="lg">Open app</PillLink>
        </div>
      </Container>
      <Door className="mx-auto mt-16 block w-full max-w-[1400px] text-ink" />
    </section>
  );
}
