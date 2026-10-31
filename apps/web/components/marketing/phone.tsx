// Flat device mock and the illustrative app screens used on the website (example figures, not live data).
import type { ReactNode } from "react";
import { AgentBudgetGlyph, LockedPotGlyph } from "@/components/icons/custom";
import * as I from "./f7";
import { Glyph } from "./f7";
import { cx, IconTile, type TileColor } from "./ui";

export function Phone({ children, className, label }: { children: ReactNode; className?: string; label?: string }) {
  return (
    <div role={label ? "img" : undefined} aria-label={label} className={cx("relative mx-auto w-[300px] rounded-[48px] bg-[#0B0C0E] p-[10px] dark:bg-[#2A2D33]", className)}>
      <div className="relative h-[600px] overflow-hidden rounded-[38px] bg-bg">
        <div className="absolute left-1/2 top-2.5 z-10 h-[26px] w-[92px] -translate-x-1/2 rounded-full bg-[#0B0C0E]" aria-hidden />
        <div className="flex h-11 items-end justify-between px-7 pb-1 text-[12px] font-semibold tabular" aria-hidden>
          <span>9:41</span>
          <span className="flex gap-1">
            <span className="h-2.5 w-4 rounded-[3px] bg-ink" />
          </span>
        </div>
        <div aria-hidden={label ? true : undefined}>{children}</div>
      </div>
    </div>
  );
}

export function Money({ value, className, decimalsClass = "text-ink-3" }: { value: string; className?: string; decimalsClass?: string }) {
  const [int, dec] = value.split(".");
  return (
    <span className={cx("tabular", className)}>
      {int}
      {dec !== undefined ? <span className={cx("text-[0.6em]", decimalsClass)}>.{dec}</span> : null}
    </span>
  );
}

function RoundAction({ d, label }: { d: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <span className="flex size-11 items-center justify-center rounded-full bg-accent text-accent-ink"><Glyph d={d} size={20} /></span>
      <span className="text-[11px] font-medium">{label}</span>
    </div>
  );
}

function PotCard({ color, name, amount, d, glyph, bar }: { color: TileColor; name: string; amount: string; d?: string; glyph?: ReactNode; bar?: number }) {
  return (
    <div className="rounded-[18px] bg-surface p-3">
      <IconTile color={color} d={d} size={30} solid>{glyph}</IconTile>
      <p className="mt-2.5 text-[12px] text-ink-2">{name}</p>
      <p className="text-[15px] font-semibold tabular">{amount}</p>
      {bar !== undefined ? (
        <div className="mt-2 h-1 rounded-full bg-surface-2"><div className="h-1 rounded-full bg-ink" style={{ width: `${bar}%` }} /></div>
      ) : null}
    </div>
  );
}

export function HomeScreen() {
  return (
    <div className="px-4">
      <div className="flex items-center justify-between pt-2">
        <span className="flex size-8 items-center justify-center rounded-full bg-tile-violet-soft text-[13px] font-semibold text-tile-violet">A</span>
        <span className="rounded-full bg-surface px-3 py-1 text-[11px] font-medium text-ink-2">ada</span>
        <span className="flex size-8 items-center justify-center rounded-full bg-surface text-ink-2"><Glyph d={I.bellFill} size={14} /></span>
      </div>
      <div className="pt-7 text-center">
        <p className="text-[12px] text-ink-2">Total · USDC + USDT</p>
        <p className="mt-1 text-[40px] font-bold tracking-[-0.03em] font-display leading-none"><Money value="1,240.50" /></p>
        <div className="mt-3 flex justify-center gap-1.5 text-[11px]">
          <span className="rounded-full bg-surface px-2.5 py-1">Spend <b className="tabular">312.40</b></span>
          <span className="rounded-full bg-surface px-2.5 py-1">Locked <b className="tabular">400.00</b></span>
        </div>
      </div>
      <div className="mt-6 grid grid-cols-4">
        <RoundAction d={I.arrowDown} label="Receive" />
        <RoundAction d={I.arrowUp} label="Withdraw" />
        <RoundAction d={I.arrowRightArrowLeft} label="Move" />
        <RoundAction d={I.ellipsis} label="More" />
      </div>
      <div className="mt-6 grid grid-cols-2 gap-2">
        <PotCard color="blue" name="Spend" amount="312.40" d={I.creditcardFill} />
        <PotCard color="sun" name="Bills" amount="186.00" d={I.docTextFill} />
        <PotCard color="mint" name="Laptop" amount="342.10" d={I.flagFill} bar={57} />
        <PotCard color="stone" name="Rainy day" amount="400.00" glyph={<LockedPotGlyph size={15} />} />
      </div>
    </div>
  );
}

export function ConsentScreen() {
  return (
    <div className="px-5 pt-4">
      <span className="flex size-12 items-center justify-center rounded-[16px] bg-tile-violet text-white dark:text-[#0B0C0E]"><AgentBudgetGlyph size={24} /></span>
      <h3 className="mt-4 text-[21px] font-bold tracking-[-0.02em] font-display leading-tight">Let “Bill payer” help with your money?</h3>
      <p className="mt-2 text-[13px] text-ink-2">Oiko cannot verify who runs this agent. Only connect agents you trust.</p>
      <div className="mt-4 divide-y divide-line rounded-[18px] bg-surface text-[13px]">
        {[
          ["See your balances and bills", I.eyeFill],
          ["Pay your bills, up to 120 USDT a week", I.docTextFill],
          ["Only to people on your list", I.person2Fill],
          ["Until 1 March, or until you disconnect", I.timerFill],
        ].map(([t, d]) => (
          <div key={t} className="flex items-center gap-3 px-3.5 py-3">
            <span className="text-accent"><Glyph d={d} size={16} /></span>
            <span>{t}</span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[12px] text-ink-2">It can never take money out to itself or change these limits.</p>
      <div className="mt-4 flex h-11 items-center justify-center rounded-full bg-pill text-[14px] font-semibold text-pill-ink">Allow with these limits</div>
    </div>
  );
}

function CapBar({ label, used, cap, warn }: { label: string; used: number; cap: number; warn?: boolean }) {
  return (
    <div>
      <div className="flex justify-between text-[12px]"><span className="text-ink-2">{label}</span><span className="tabular font-medium">{used} / {cap} USDT</span></div>
      <div className="mt-1.5 h-1.5 rounded-full bg-surface-2"><div className={cx("h-1.5 rounded-full", warn ? "bg-warning" : "bg-accent")} style={{ width: `${(used / cap) * 100}%` }} /></div>
    </div>
  );
}

export function CapsScreen() {
  return (
    <div className="px-4 pt-4">
      <p className="text-[12px] font-semibold text-ink-2">Agents</p>
      <div className="mt-2 rounded-[18px] bg-surface p-4">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-[13px] bg-tile-violet text-white dark:text-[#0B0C0E]"><AgentBudgetGlyph size={20} /></span>
          <div className="min-w-0">
            <p className="text-[14px] font-semibold">Bill payer</p>
            <p className="text-[12px] text-ink-2">Can pay bills · 3 payees</p>
          </div>
          <span className="ml-auto rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-semibold text-success-ink">Active</span>
        </div>
        <div className="mt-4 space-y-3">
          <CapBar label="Per payment" used={45} cap={60} />
          <CapBar label="Today" used={45} cap={60} warn />
          <CapBar label="This week" used={70} cap={120} />
        </div>
      </div>
      <div className="mt-2 rounded-[18px] bg-surface p-4 text-[12px]">
        <p className="font-semibold text-[13px]">Allowed payees</p>
        {["Ikeja Electric", "Landlord · rent", "Fibre internet"].map((n) => (
          <div key={n} className="mt-2 flex items-center gap-2 text-ink-2"><Glyph d={I.checkmarkCircleFill} size={14} className="text-success" />{n}</div>
        ))}
      </div>
      <div className="mt-3 flex h-11 items-center justify-center rounded-full bg-danger text-[14px] font-semibold text-white dark:text-[#0B0C0E]">Disconnect</div>
    </div>
  );
}

export function ProposalScreen() {
  return (
    <div className="px-4 pt-4">
      <p className="text-[12px] font-semibold text-ink-2">Waiting for you</p>
      <div className="mt-2 rounded-[18px] bg-surface p-4">
        <div className="flex items-center gap-2 text-[12px] text-ink-2">
          <span className="flex size-6 items-center justify-center rounded-[8px] bg-tile-violet text-white dark:text-[#0B0C0E]"><AgentBudgetGlyph size={13} /></span>
          Money coach suggests
        </div>
        <p className="mt-3 text-[16px] font-semibold leading-snug">Move 40 USDT from Spend to Laptop.</p>
        <p className="mt-2 text-[13px] italic text-ink-2">“You spent less than planned this week. This keeps the laptop on track for June.”</p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="flex h-10 items-center justify-center rounded-full bg-surface-2 text-[13px] font-semibold">Reject</div>
          <div className="flex h-10 items-center justify-center rounded-full bg-pill text-[13px] font-semibold text-pill-ink">Approve</div>
        </div>
      </div>
      <div className="mt-2 rounded-[18px] bg-surface p-4 text-[12px] text-ink-2">
        Proposals never move money until you tap Approve.
      </div>
    </div>
  );
}

export function ActivityScreen() {
  const rows: Array<[string, string, string, TileColor, string]> = [
    ["Paid Ikeja Electric", "Bill payer · agent", "−25.00", "violet", I.boltFill],
    ["From Sam", "Your plan ran: 4 pots", "+300.00", "mint", I.arrowDown],
    ["Moved to Laptop", "You approved Money coach", "40.00", "blue", I.arrowRightArrowLeft],
    ["Refused: gadgets.shop", "Not on the allowed list", "0.00", "rose", I.xmarkShieldFill],
    ["Paid rent", "Bill payer · agent", "−45.00", "violet", I.houseFill],
  ];
  return (
    <div className="px-4 pt-4">
      <p className="text-[12px] font-semibold text-ink-2">Activity</p>
      <div className="mt-2 divide-y divide-line rounded-[18px] bg-surface">
        {rows.map(([t, s, a, c, d]) => (
          <div key={t} className="flex items-center gap-3 px-3.5 py-3">
            <IconTile color={c} d={d} size={32} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold">{t}</p>
              <p className="truncate text-[11px] text-ink-2">{s}</p>
            </div>
            <span className={cx("text-[13px] font-semibold tabular", a.startsWith("+") && "text-success-ink")}>{a}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
