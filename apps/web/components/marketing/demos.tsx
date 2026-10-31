"use client";
// The three "Try it right here" tools. Self-contained, local state only. Simulation, no real money.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AgentBudgetGlyph, PayLinkGlyph } from "@/components/icons/custom";
import { Glyph, checkmarkCircleFill, xmarkCircleFill, chartPieFill, checkmarkAlt, docOnDoc } from "./f7";
import { cx, IconTile, pillClass, SimLabel, Slider } from "./ui";

const fmt = (n: number) => n.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const NAME_RE = /^[a-z0-9_-]{2,32}$/;

function DemoCard({ icon, title, lead, children }: { icon: ReactNode; title: string; lead: string; children: ReactNode }) {
  return (
    <div className="flex flex-col rounded-card bg-surface p-5 md:p-7">
      <div className="flex items-start justify-between gap-3">
        {icon}
        <SimLabel />
      </div>
      <h3 className="mt-5 text-[22px] font-bold tracking-[-0.02em] font-display">{title}</h3>
      <p className="mt-1.5 text-[15px] text-ink-2">{lead}</p>
      <div className="mt-6 flex flex-1 flex-col">{children}</div>
    </div>
  );
}

function Chips<T extends string | number>({ options, value, onChange, label, render }: { options: readonly T[]; value: T; onChange: (v: T) => void; label: string; render?: (v: T) => string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button key={String(o)} type="button" role="radio" aria-checked={o === value} onClick={() => onChange(o)}
          className={cx("mk-press h-9 rounded-full px-3.5 text-[14px] font-semibold transition-colors", o === value ? "bg-pill text-pill-ink" : "bg-surface-2 text-ink hover:bg-line")}>
          {render ? render(o) : String(o)}
        </button>
      ))}
    </div>
  );
}

const useTimers = () => {
  const t = useRef<number[]>([]);
  useEffect(() => () => t.current.forEach(clearTimeout), []);
  return {
    later: (fn: () => void, ms: number) => { t.current.push(window.setTimeout(fn, ms)); },
    clear: () => { t.current.forEach(clearTimeout); t.current = []; },
  };
};

/* ---------------- 1. Get paid by name ---------------- */
const SOURCES = ["USDT on TRON", "USDC on Base", "USDT on BNB Chain"] as const;
const STEPS = ["Waiting for your payment", "Received", "Delivering", "Done"] as const;

export function PayByNameDemo() {
  const [name, setName] = useState("ada");
  const [source, setSource] = useState<(typeof SOURCES)[number]>("USDT on TRON");
  const [amount, setAmount] = useState(50);
  const [step, setStep] = useState(-1);
  const [copied, setCopied] = useState(false);
  const { later, clear } = useTimers();
  const valid = NAME_RE.test(name);
  const token = source.split(" ")[0];
  const [host, setHost] = useState("");
  useEffect(() => setHost(window.location.host), []);
  const link = `${host}/pay/${valid ? name : "yourname"}`;

  const run = () => {
    clear();
    setStep(0);
    [1, 2, 3].forEach((s) => later(() => setStep(s), s * 900));
  };

  return (
    <DemoCard icon={<IconTile color="blue" size={44} solid><PayLinkGlyph size={22} /></IconTile>} title="Get paid by name" lead="Pick a name. Share one link. Anyone can pay it from wherever their money is.">
      <label className="text-[13px] font-semibold text-ink-2" htmlFor="demo-name">Your name</label>
      <div className="mt-2 flex items-center rounded-input bg-surface-2 px-3.5 h-12 focus-within:shadow-[0_0_0_2px_var(--focus)]">
        <input id="demo-name" value={name} maxLength={32} onChange={(e) => { setName(e.target.value.toLowerCase().replace(/\s/g, "")); setStep(-1); }}
          className="w-0 flex-1 bg-transparent text-[16px] font-semibold outline-none" autoComplete="off" spellCheck={false} />
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 rounded-input border border-dashed border-line px-3.5 py-2.5">
        <span className="truncate font-mono text-[13px]">{link}</span>
        <button type="button" onClick={() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }} className="inline-flex shrink-0 items-center gap-1 text-[13px] font-semibold text-accent" aria-label="Copy pay link (simulated)">
          <Glyph d={copied ? checkmarkAlt : docOnDoc} size={13} />{copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="mt-5 text-[13px] font-semibold text-ink-2">A friend pays with</p>
      <div className="mt-2"><Chips label="Where the money comes from" options={SOURCES} value={source} onChange={(v) => { setSource(v); setStep(-1); }} /></div>
      <div className="mt-3"><Chips label="Amount" options={[20, 50, 100] as const} value={amount} onChange={(v) => { setAmount(v); setStep(-1); }} render={(v) => `${v} ${token}`} /></div>
      <ol className="mt-5 space-y-2.5" aria-live="polite">
        {STEPS.map((s, i) => (
          <li key={s} className={cx("flex items-center gap-2.5 text-[14px] transition-opacity", step >= i ? "opacity-100" : "opacity-40")}>
            <span className={cx("flex size-5 items-center justify-center rounded-full", step > i || step === 3 ? "bg-success text-white dark:text-[#0B0C0E]" : step === i ? "bg-accent text-accent-ink" : "bg-surface-2")}>
              {step > i || step === 3 ? <Glyph d={checkmarkAlt} size={10} /> : null}
            </span>
            {s}
          </li>
        ))}
      </ol>
      <div className="mt-auto pt-6">
        {step === 3 ? (
          <p className="mb-3 rounded-input bg-success-soft px-3.5 py-3 text-[14px] font-medium text-success-ink">
            {fmt(amount)} {token} arrived for {valid ? name : "you"}. Your plan split it into pots.
          </p>
        ) : null}
        <button type="button" disabled={!valid || (step >= 0 && step < 3)} onClick={run} className={pillClass("black", "md", "w-full")}>
          {step === 3 ? "Send another" : `Send ${amount} ${token} to ${valid ? name : "…"}`}
        </button>
      </div>
    </DemoCard>
  );
}

/* ---------------- 2. Watch your plan run ---------------- */
const POTS = [
  { key: "bills", label: "Bills", cls: "bg-tile-sun" },
  { key: "savings", label: "Savings", cls: "bg-tile-mint" },
  { key: "goal", label: "Laptop", cls: "bg-tile-violet" },
  { key: "spend", label: "Spend", cls: "bg-tile-blue" },
] as const;

export function PlanDemo() {
  const [amount, setAmount] = useState<50 | 200 | 1000>(200);
  const [pct, setPct] = useState({ bills: 30, savings: 20, goal: 10 });
  const [totals, setTotals] = useState({ bills: 0, savings: 0, goal: 0, spend: 0 });
  const [runs, setRuns] = useState(0);
  const spendPct = 100 - pct.bills - pct.savings - pct.goal;
  const all = { ...pct, spend: spendPct };
  const part = (k: keyof typeof all) => (amount * all[k]) / 100;

  const set = (k: keyof typeof pct, v: number) =>
    setPct((p) => {
      const others = Object.entries(p).filter(([kk]) => kk !== k).reduce((a, [, n]) => a + n, 0);
      return { ...p, [k]: Math.min(v, 100 - others) };
    });

  return (
    <DemoCard icon={<IconTile color="violet" size={44} solid d={chartPieFill} />} title="Watch your plan run" lead="Set your plan once. Every payment that comes in is split the moment it lands.">
      <p className="text-[13px] font-semibold text-ink-2">You get paid</p>
      <div className="mt-2"><Chips label="Payment amount" options={[50, 200, 1000] as const} value={amount} onChange={setAmount} render={(v) => `${v.toLocaleString("en")} USDT`} /></div>
      <div className="mt-5 flex h-3 overflow-hidden rounded-full bg-surface-2" aria-hidden>
        {POTS.map((p) => (
          <div key={p.key} className={cx(p.cls, "h-full transition-[width] duration-300")} style={{ width: `${all[p.key]}%` }} />
        ))}
      </div>
      <div className="mt-5 space-y-4">
        {(["bills", "savings", "goal"] as const).map((k) => {
          const p = POTS.find((x) => x.key === k)!;
          return (
            <div key={k}>
              <div className="mb-1 flex items-center justify-between text-[14px]">
                <label htmlFor={`plan-${k}`} className="inline-flex items-center gap-2 font-medium"><span className={cx("size-2.5 rounded-full", p.cls)} />{p.label}</label>
                <span className="tabular text-ink-2">{pct[k]}% · {fmt(part(k))} USDT</span>
              </div>
              <Slider id={`plan-${k}`} label={`${p.label} share`} value={pct[k]} min={0} max={80} step={5} valueText={`${pct[k]} percent`} onChange={(v) => set(k, v)} />
            </div>
          );
        })}
        <div className="flex items-center justify-between text-[14px]">
          <span className="inline-flex items-center gap-2 font-medium"><span className="size-2.5 rounded-full bg-tile-blue" />Spend (the rest)</span>
          <span className="tabular text-ink-2">{spendPct}% · {fmt(part("spend"))} USDT</span>
        </div>
      </div>
      <p className="mt-5 rounded-input bg-surface-2 px-3.5 py-3 text-[14px] leading-relaxed" aria-live="polite">
        If you get paid {amount.toLocaleString("en")} USDT: {fmt(part("bills"))} to Bills, {fmt(part("savings"))} to Savings, {fmt(part("goal"))} to Laptop, {fmt(part("spend"))} to Spend.
      </p>
      <div className="mt-auto pt-6">
        {runs > 0 ? (
          <div className="mb-3 grid grid-cols-4 gap-1.5 text-center" aria-live="polite">
            {POTS.map((p) => (
              <div key={p.key} className="rounded-[12px] bg-surface-2 px-1 py-2">
                <p className="text-[11px] text-ink-2">{p.label}</p>
                <p className="text-[13px] font-semibold tabular">{fmt(totals[p.key])}</p>
              </div>
            ))}
          </div>
        ) : null}
        <button type="button" onClick={() => { setTotals((t) => ({ bills: t.bills + part("bills"), savings: t.savings + part("savings"), goal: t.goal + part("goal"), spend: t.spend + part("spend") })); setRuns((r) => r + 1); }} className={pillClass("black", "md", "w-full")}>
          Get paid {amount.toLocaleString("en")} USDT
        </button>
      </div>
    </DemoCard>
  );
}

/* ---------------- 3. Give an agent a budget ---------------- */
const PAYEES = [
  { id: "power", label: "Ikeja Electric", note: "Electricity" },
  { id: "rent", label: "Landlord", note: "Rent" },
  { id: "gadgets", label: "gadgets.shop", note: "Unknown shop" },
] as const;
const ATTEMPTS = [
  { to: "power", what: "Pay electricity", amount: 25 },
  { to: "rent", what: "Pay rent share", amount: 45 },
  { to: "gadgets", what: "Buy headphones", amount: 60 },
] as const;
type Result = { what: string; amount: number; ok: boolean; reason: string };

export function AgentDemo() {
  const [cap, setCap] = useState(100);
  const [allow, setAllow] = useState<Record<string, boolean>>({ power: true, rent: true, gadgets: false });
  const [connected, setConnected] = useState(true);
  const [results, setResults] = useState<Result[]>([]);
  const [running, setRunning] = useState(false);
  const { later, clear } = useTimers();
  const spent = results.filter((r) => r.ok).reduce((a, r) => a + r.amount, 0);

  const run = () => {
    clear();
    setResults([]);
    setRunning(true);
    let used = 0;
    const out: Result[] = ATTEMPTS.map((a) => {
      const payee = PAYEES.find((p) => p.id === a.to)!;
      const base = { what: `${a.what} · ${payee.label}`, amount: a.amount };
      if (!connected) return { ...base, ok: false, reason: "Refused: agent disconnected" };
      if (!allow[a.to]) return { ...base, ok: false, reason: "Refused: not on your list" };
      if (used + a.amount > cap) return { ...base, ok: false, reason: `Refused: over your ${cap} USDT weekly cap` };
      used += a.amount;
      return { ...base, ok: true, reason: "Paid, within your limits" };
    });
    out.forEach((r, i) => later(() => { setResults((rs) => [...rs, r]); if (i === out.length - 1) setRunning(false); }, 500 * (i + 1)));
  };

  return (
    <DemoCard icon={<IconTile color="violet" size={44} solid><AgentBudgetGlyph size={22} /></IconTile>} title="Give an agent a budget" lead="Your agent can pay, but only who you allow, only up to your cap. Disconnect any time.">
      <div className="flex items-center justify-between text-[14px]">
        <label htmlFor="agent-cap" className="font-medium">Weekly cap</label>
        <span className="tabular font-semibold">{cap} USDT</span>
      </div>
      <div className="mt-1"><Slider id="agent-cap" label="Weekly cap" value={cap} min={20} max={300} step={10} valueText={`${cap} USDT a week`} onChange={(v) => { setCap(v); setResults([]); }} /></div>
      <div className="mt-2 h-1.5 rounded-full bg-surface-2" aria-hidden>
        <div className={cx("h-1.5 rounded-full transition-[width] duration-300", spent / cap >= 0.8 ? "bg-warning" : "bg-accent")} style={{ width: `${Math.min(100, (spent / cap) * 100)}%` }} />
      </div>
      <p className="mt-1.5 text-[12px] text-ink-2 tabular">{spent} of {cap} USDT used this week</p>
      <fieldset className="mt-5">
        <legend className="text-[13px] font-semibold text-ink-2">Allowed to pay</legend>
        <div className="mt-2 divide-y divide-line rounded-input bg-surface-2">
          {PAYEES.map((p) => (
            <label key={p.id} className="flex cursor-pointer items-center gap-3 px-3.5 py-2.5 text-[14px]">
              <input type="checkbox" className="peer sr-only" checked={allow[p.id]} onChange={(e) => { setAllow((a) => ({ ...a, [p.id]: e.target.checked })); setResults([]); }} />
              <span className="flex-1"><span className="font-medium">{p.label}</span> <span className="text-ink-2">· {p.note}</span></span>
              <span aria-hidden className={cx("relative h-6 w-10 rounded-full transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus", allow[p.id] ? "bg-success" : "bg-line")}>
                <span className={cx("absolute top-0.5 size-5 rounded-full bg-white shadow-sm transition-transform", allow[p.id] ? "translate-x-[18px]" : "translate-x-0.5")} />
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <ul className="mt-4 space-y-2" aria-live="polite">
        {results.map((r) => (
          <li key={r.what} className={cx("flex items-start gap-2.5 rounded-input px-3.5 py-2.5 text-[13px]", r.ok ? "bg-success-soft" : "bg-danger-soft")}>
            <Glyph d={r.ok ? checkmarkCircleFill : xmarkCircleFill} size={16} className={cx("mt-px shrink-0", r.ok ? "text-success-ink" : "text-danger-ink")} />
            <span className="flex-1">
              <span className="font-semibold">{r.what}, {r.amount} USDT</span>
              <span className={cx("block", r.ok ? "text-success-ink" : "text-danger-ink")}>{r.reason}</span>
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-auto grid grid-cols-2 gap-2 pt-6">
        <button type="button" onClick={run} disabled={running} className={pillClass("black", "md")}>Run agent</button>
        {connected ? (
          <button type="button" onClick={() => { clear(); setRunning(false); setConnected(false); setResults([]); }} className={pillClass("secondary", "md", "text-danger-ink")}>Disconnect</button>
        ) : (
          <button type="button" onClick={() => { setConnected(true); setResults([]); }} className={pillClass("secondary", "md")}>Reconnect</button>
        )}
      </div>
      {!connected ? <p className="mt-3 text-[13px] font-medium text-danger-ink" role="status">Disconnected. The agent&rsquo;s key is revoked; every request is refused.</p> : null}
    </DemoCard>
  );
}
