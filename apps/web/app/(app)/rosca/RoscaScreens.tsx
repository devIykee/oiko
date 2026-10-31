"use client";
// ROSCA savings (rotating savings groups). Contract identifiers stay ajo_* (AjoClient, ajo_contribute, ...).
import {
  Badge, Button, CircleTimeline, CopyField, EmptyState, GroupedList, Input, ListRow, Note, QRCodeCard, SectionTitle, SegmentedControl, Toggle,
} from "@oiko/ui";
import type { Circle, Token } from "@oiko/sdk";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ConfirmSheet } from "@/components/app/ConfirmSheet";
import { PageHeader } from "@/components/app/PageHeader";
import { LoadError, PageSkeleton } from "@/components/app/States";
import { useMoney } from "@/lib/actions";
import { useCircle, useCircles } from "@/lib/data";
import { useConfig } from "@/lib/config";
import { fmtDate, fmtToken, nsToMs, parseUnits } from "@/lib/format";
import { useT, type TFn } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { PotsTabs } from "../pots/PotsScreen";

const memberName = (id: string) => id.replace(/^vault\./, "").split(".")[0] ?? id;
const DAY_NS = 86_400_000_000_000n;
const INVITE_KEY = (id: number) => `oiko-rosca-invite-${id}`;
async function sha256Hex(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}
function savedInvite(id: number): string | undefined {
  try { return localStorage.getItem(INVITE_KEY(id)) ?? undefined; } catch { return undefined; }
}

function periodLabel(periodNs: string, t: TFn) {
  const d = Number(BigInt(periodNs) / DAY_NS);
  if (d === 7) return t("rosca.weekly");
  if (d >= 28 && d <= 31) return t("rosca.monthly");
  if (d >= 1) return t("rosca.everyDays", { n: d });
  return t("rosca.everyMinutes", { n: Math.max(1, Number(BigInt(periodNs) / 60_000_000_000n)) });
}
const rowSub = (c: Circle, t: TFn) =>
  t("rosca.rowSub", { amount: fmtToken(c.amount_per_round, c.token), period: periodLabel(c.period_ns, t), members: t("rosca.members", { n: c.members.length, max: c.max_members }) });

export function RoscaListScreen() {
  const t = useT();
  const router = useRouter();
  const groups = useCircles();
  const [code, setCode] = useState("");
  return (
    <div className="oi-col oi-page" data-testid="rosca">
      <PageHeader title={t("nav.pots")} action={<Button size="sm" icon="add" onClick={() => router.push("/rosca/new")}>{t("rosca.new")}</Button>} />
      <PotsTabs current="rosca" />
      <p className="oi-small oi-muted oi-pretty" style={{ margin: 0 }}>{t("rosca.intro")}</p>
      {groups.error && !groups.data ? <LoadError error={groups.error} onRetry={groups.refresh} /> : !groups.data ? <PageSkeleton rows={2} /> : groups.data.length === 0 ? (
        <div className="oi-card"><EmptyState icon="ajo" color="rose" title={t("rosca.emptyTitle")} body={t("rosca.emptyBody")} action={<Button onClick={() => router.push("/rosca/new")}>{t("rosca.new")}</Button>} /></div>
      ) : (
        <GroupedList label={t("nav.rosca")}>
          {groups.data.map((c) => (
            <ListRow key={c.id} href={`/rosca/${c.id}`} as={Link} icon="ajo" color="rose" title={c.name} chevron data-testid={`rosca-${c.id}`}
              subtitle={rowSub(c, t)} meta={t(`rosca.status.${c.status}`)} />
          ))}
        </GroupedList>
      )}
      <section className="oi-card oi-stack-sm" aria-labelledby="join-code">
        <h2 id="join-code" className="oi-h2" style={{ fontSize: 16 }}>{t("rosca.haveInvite")}</h2>
        <Input label={t("rosca.inviteCode")} value={code} onChange={(e) => setCode(e.target.value.trim())} placeholder="3-k7x9q2" />
        <Button variant="secondary" disabled={!/^\d+-.+/.test(code)} onClick={() => router.push(`/rosca/join/${encodeURIComponent(code)}`)}>{t("rosca.join")}</Button>
      </section>
    </div>
  );
}

export function RoscaNewScreen() {
  const t = useT();
  const router = useRouter();
  const { exec } = useMoney();
  const { isTestMode } = useConfig();
  const [name, setName] = useState("");
  const [coin, setCoin] = useState<Token>("usdt");
  const [amount, setAmount] = useState("");
  const [period, setPeriod] = useState<"minute" | "week" | "month">("week");
  const [members, setMembers] = useState("5");
  const [bond, setBond] = useState(true);
  const [shuffle, setShuffle] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const units = parseUnits(amount);
  const n = Math.max(2, Math.min(20, Number(members) || 0));
  const valid = name.trim().length > 1 && !!units && n >= 2;

  return (
    <div className="oi-col oi-page" data-testid="rosca-new">
      <PageHeader title={t("rosca.new")} back="/rosca" />
      <Input label={t("rosca.name")} value={name} onChange={(e) => setName(e.target.value.slice(0, 40))} placeholder={t("rosca.namePlaceholder")} />
      <SegmentedControl label={t("common.token")} value={coin} onChange={setCoin} items={[{ value: "usdt", label: "USDT" }, { value: "usdc", label: "USDC" }]} />
      <Input label={t("rosca.amountPerRound")} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" suffix={coin.toUpperCase()} placeholder="50" />
      <SegmentedControl label={t("rosca.period")} value={period} onChange={setPeriod} items={[...(isTestMode ? [{ value: "minute" as const, label: t("rosca.testMinute") }] : []), { value: "week" as const, label: t("rosca.weekly") }, { value: "month" as const, label: t("rosca.monthly") }]} />
      <Input label={t("rosca.maxMembers")} value={members} onChange={(e) => setMembers(e.target.value.replace(/\D/g, "").slice(0, 2))} inputMode="numeric" hint={t("rosca.maxMembersHint")} />
      <GroupedList label={t("rosca.rules")}>
        <ListRow icon="shield" color="mint" title={t("rosca.bond")} subtitle={t("rosca.bondHelp")} trailing={<Toggle checked={bond} onChange={setBond} label={t("rosca.bond")} />} />
        <ListRow icon="refresh" color="blue" title={t("rosca.shuffle")} subtitle={t("rosca.shuffleHelp")} trailing={<Toggle checked={shuffle} onChange={setShuffle} label={t("rosca.shuffle")} />} />
      </GroupedList>
      <Note tone="info">{t("rosca.enforced")}</Note>
      <Button block size="lg" disabled={!valid} onClick={() => setConfirm(true)}>{t("common.continue")}</Button>
      {confirm && units && (
        <ConfirmSheet open onOpenChange={setConfirm} title={t("rosca.new")}
          sentence={t("rosca.createSentence", { name, amount: fmtToken(units, coin), period: period === "minute" ? t("rosca.everyMinutes", { n: 1 }) : period === "week" ? t("rosca.weekly") : t("rosca.monthly"), n })}
          confirmLabel={t("rosca.create")} successText={t("rosca.created")}
          onConfirm={async () => {
            const code = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => (b % 36).toString(36)).join("");
            const periodNs = period === "minute" ? 60_000_000_000n : BigInt(period === "week" ? 7 : 30) * DAY_NS;
            const r = await exec("ajoCreate", {
              name, token: coin, amount_per_round: units, period_ns: periodNs.toString(),
              max_members: n, bond_amount: bond ? units : null, shuffle, invite_code_hash: await sha256Hex(code),
            });
            const id = Number(r.value);
            if (Number.isFinite(id) && id > 0) {
              try { localStorage.setItem(INVITE_KEY(id), code); } catch { /* invite link still shown this session */ }
              router.push(`/rosca/${id}`);
            } else router.push("/rosca");
          }} />
      )}
    </div>
  );
}

function RoscaView({ c, inviteCode }: { c: Circle; inviteCode?: string }) {
  const t = useT();
  const { session } = useSession();
  const { exec } = useMoney();
  const [sheet, setSheet] = useState<null | "pay" | "bond" | "join" | "start">(null);
  const me = session?.vaultId ?? "";
  const member = c.members.includes(me);
  const organiser = c.organiser === me;
  const order = c.order.length ? c.order : c.members;
  const paidThisRound = c.paid.some(([r, m]) => r === c.round && m === me);
  const hasBond = !!c.bonds[me];
  const startMs = c.start_at ? nsToMs(c.start_at) : null;
  const periodMs = Number(BigInt(c.period_ns) / 1_000_000n);
  const slots = order.map((m, i) => ({
    name: m === me ? t("common.who.you") : memberName(m),
    round: i,
    state: (c.defaults.some(([r, d]) => d === m && r === i) ? "default" : i < c.round ? "paid" : i === c.round && c.status === "active" ? "current" : "upcoming") as "paid" | "current" | "upcoming" | "default",
    caption: startMs ? fmtDate(startMs + (i + 1) * periodMs, { day: "numeric", month: "short" }) : t("rosca.roundN", { n: i + 1 }),
  }));
  const link = typeof window !== "undefined" && inviteCode ? `${window.location.origin}/rosca/join/${c.id}-${inviteCode}` : null;

  return (
    <>
      <div className="oi-card oi-stack-sm">
        <div className="oi-row"><span style={{ fontWeight: 700, fontSize: 20, flex: 1 }}>{c.name}</span><Badge tone={c.status === "active" ? "success" : "neutral"}>{t(`rosca.status.${c.status}`)}</Badge></div>
        <div className="oi-small oi-muted">{rowSub(c, t)}</div>
        {BigInt(c.bond_amount) > 0n && <div className="oi-small">{t("rosca.bondAmount", { amount: fmtToken(c.bond_amount, c.token) })}</div>}
      </div>
      <section aria-labelledby="order">
        <SectionTitle id="order">{t("rosca.order")}</SectionTitle>
        <div className="oi-card"><CircleTimeline slots={slots} label={t("rosca.order")} /></div>
      </section>
      {member && c.status === "active" && (
        <Button block size="lg" disabled={paidThisRound} onClick={() => setSheet("pay")} data-testid="rosca-pay">
          {paidThisRound ? t("rosca.paidThisRound") : t("rosca.payRound", { amount: fmtToken(c.amount_per_round, c.token) })}
        </Button>
      )}
      {member && c.status === "forming" && BigInt(c.bond_amount) > 0n && !hasBond && (
        <Button block size="lg" variant="secondary" onClick={() => setSheet("bond")}>{t("rosca.postBond", { amount: fmtToken(c.bond_amount, c.token) })}</Button>
      )}
      {organiser && c.status === "forming" && (
        <Button block size="lg" variant="secondary" disabled={c.members.length < 2} onClick={() => setSheet("start")} data-testid="rosca-start">
          {c.members.length < 2 ? t("rosca.needTwo") : t("rosca.start")}
        </Button>
      )}
      {!member && inviteCode && c.status === "forming" && (
        <Button block size="lg" onClick={() => setSheet("join")} data-testid="rosca-join">{t("rosca.joinGroup")}</Button>
      )}
      {link && member && (
        <section className="oi-card oi-stack-sm" aria-labelledby="invite">
          <h2 id="invite" className="oi-h2" style={{ fontSize: 16 }}>{t("rosca.invite")}</h2>
          <QRCodeCard value={link} label={t("rosca.invite")} size={180} />
          <CopyField label={t("rosca.inviteLink")} value={link} copyLabel={t("common.copy")} copiedLabel={t("common.copied")} />
        </section>
      )}
      <Note tone="info">{t("rosca.enforced")}</Note>
      {sheet === "pay" && <ConfirmSheet open onOpenChange={() => setSheet(null)} title={t("rosca.payTitle")}
        sentence={t("rosca.paySentence", { amount: fmtToken(c.amount_per_round, c.token), name: c.name })} confirmLabel={t("rosca.pay")} successText={t("rosca.paid")}
        onConfirm={() => exec("ajoContribute", c.id, c.token, c.amount_per_round)} />}
      {sheet === "bond" && <ConfirmSheet open onOpenChange={() => setSheet(null)} title={t("rosca.bond")}
        sentence={t("rosca.bondSentence", { amount: fmtToken(c.bond_amount, c.token), name: c.name })} confirmLabel={t("rosca.postBondShort")} successText={t("rosca.bondPosted")}
        onConfirm={() => exec("ajoPostBond", c.id, c.token, c.bond_amount)} />}
      {sheet === "start" && <ConfirmSheet open onOpenChange={() => setSheet(null)} title={t("rosca.start")}
        sentence={t("rosca.startSentence", { name: c.name, n: c.members.length })} confirmLabel={t("rosca.start")} successText={t("rosca.started")}
        onConfirm={() => exec("ajoStart", c.id)} />}
      {sheet === "join" && inviteCode && <ConfirmSheet open onOpenChange={() => setSheet(null)} title={t("rosca.joinGroup")}
        sentence={t("rosca.joinSentence", { name: c.name, amount: fmtToken(c.amount_per_round, c.token), period: periodLabel(c.period_ns, t) })} confirmLabel={t("rosca.join")} successText={t("rosca.joined")}
        onConfirm={() => exec("ajoJoin", c.id, inviteCode)} />}
    </>
  );
}

export function RoscaScreen() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const q = useCircle(Number(id));
  const [invite, setInvite] = useState<string | undefined>(undefined);
  useEffect(() => { setInvite(savedInvite(Number(id))); }, [id]);
  return (
    <div className="oi-col oi-page" data-testid="rosca-group">
      <PageHeader title={t("nav.rosca")} back="/rosca" />
      {q.error && !q.data ? <LoadError error={q.error} onRetry={q.refresh} /> : q.data === undefined ? <PageSkeleton rows={3} /> : q.data === null ? <EmptyState icon="ajo" title={t("rosca.notFound")} /> : <RoscaView c={q.data} inviteCode={invite} />}
    </div>
  );
}

export function RoscaJoinScreen() {
  const t = useT();
  const { code } = useParams<{ code: string }>();
  const raw = decodeURIComponent(code);
  const m = /^(\d+)-(.+)$/.exec(raw);
  const q = useCircle(m ? Number(m[1]) : null);
  return (
    <div className="oi-col oi-page" data-testid="rosca-join-screen">
      <PageHeader title={t("rosca.joinGroup")} back="/rosca" />
      {!m ? <EmptyState icon="warning" title={t("rosca.badInvite")} /> : q.error && !q.data ? <LoadError error={q.error} /> : q.data === undefined ? <PageSkeleton rows={3} /> : q.data === null ? <EmptyState icon="ajo" title={t("rosca.notFound")} /> : <RoscaView c={q.data} inviteCode={m[2]} />}
    </div>
  );
}
