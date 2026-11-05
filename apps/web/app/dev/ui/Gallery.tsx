"use client";
// Component gallery (dev / local mode only). Not translated on purpose: it is a developer tool.
import {
  ActivityRow, AgentAccessLog, AgentCard, AmountInput, Avatar, Badge, BalanceHeader, BottomTabBar, Button, CircleTimeline, CopyField, EmptyState,
  GroupedList, HoldToConfirm, Icon, IconButton, Input, ListRow, NetworkModeBadge, Note, ProgressBar, ProposalCard, QRCodeCard,
  RiskNote, RoundAction, ScopeList, SectionTitle, SegmentedControl, SelectList, Sheet, Skeleton, StatusTimeline, Tabs, Tile, Toggle, VaultCard,
  icons, tileColors, useToast, type IconConcept,
} from "@oiko/ui";
import { useEffect, useState, type ReactNode } from "react";
import { useConfig } from "@/lib/config";
import { useSettings } from "@/lib/settings";

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="oi-stack-sm" style={{ marginBottom: 32 }}>
      <h2 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--ink-2)", margin: 0 }}>{title}</h2>
      {children}
    </section>
  );
}

export function Gallery() {
  const { config, loading } = useConfig();
  const { settings, set } = useSettings();
  const toast = useToast();
  const [bal, setBal] = useState("1,240.50");
  const [amt, setAmt] = useState("");
  const [tog, setTog] = useState(true);
  const [seg, setSeg] = useState<"a" | "b" | "c">("a");
  const [tab, setTab] = useState<"pots" | "earn" | "rosca">("pots");
  const [sel, setSel] = useState<number | null>(1);
  const [sheet, setSheet] = useState(false);
  const [tl, setTl] = useState(0);
  useEffect(() => { const h = setInterval(() => setTl((x) => (x + 1) % 5), 1500); return () => clearInterval(h); }, []);

  const allowed = process.env.NODE_ENV === "development" || config?.network === "local";
  if (loading && process.env.NODE_ENV !== "development") return null;
  if (!allowed) return <div className="oi-public__col"><EmptyState icon="lock" title="Not available" body="The component gallery is only available in local mode." /></div>;

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "24px 16px 120px" }} data-testid="gallery">
      <div className="oi-row" style={{ marginBottom: 24 }}>
        <h1 className="oi-h1" style={{ flex: 1 }}>Oiko UI</h1>
        <SegmentedControl label="Theme" value={settings.theme} onChange={(v) => set({ theme: v })} items={[{ value: "auto", label: "Auto" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} />
      </div>

      <Block title="Buttons">
        <div className="oi-row" style={{ flexWrap: "wrap" }}>
          <Button>Black pill</Button><Button variant="accent">Accent</Button><Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button><Button variant="danger">Danger</Button><Button loading>Loading</Button>
          <Button size="sm">Small</Button><Button size="lg" icon="add">Large</Button><Button disabled>Disabled</Button>
          <IconButton icon="close" label="Close" /><IconButton icon="share" label="Share" plain />
        </div>
      </Block>

      <Block title="Balance + round actions">
        <div className="oi-card">
          <BalanceHeader value={bal} label="Total stables" breakdown={<><Badge>520.40 USDC</Badge><Badge>720.10 USDT</Badge></>} />
          <div className="oi-actions" style={{ marginTop: 12 }}>
            <RoundAction icon="receive" label="Receive" primary /><RoundAction icon="withdraw" label="Withdraw" /><RoundAction icon="move" label="Move" /><RoundAction icon="moreAction" label="More" />
          </div>
          <div className="oi-row" style={{ justifyContent: "center", marginTop: 12 }}>
            <Button size="sm" variant="secondary" onClick={() => setBal((b) => (b === "1,240.50" ? "1,440.75" : "1,240.50"))}>Roll odometer</Button>
          </div>
        </div>
      </Block>

      <Block title="Pot cards (VaultCard) + progress">
        <div className="oi-pots oi-pots--3">
          <VaultCard id="g1" name="Spend" icon="spend" color="blue" amount="522.55" ticker="stablecoins" meta="Spend" />
          <VaultCard id="g2" name="Rainy day" icon="locked" color="violet" amount="150.00" ticker="stablecoins" badge={<Badge icon="lock">Locked</Badge>} meta="Locked until 1 Jan 2027" />
          <VaultCard id="g3" name="Laptop" icon="goal" color="rose" amount="212.00" ticker="stablecoins" progress={{ value: 212, max: 800, label: "Goal" }} meta="of 800.00" />
        </div>
        <ProgressBar value={0.5} label="50%" /><ProgressBar value={0.85} label="85%" /><ProgressBar value={1} label="100%" />
      </Block>

      <Block title="Lists, rows, select-as-list">
        <SectionTitle action={<a href="#">See all</a>}>Section title</SectionTitle>
        <GroupedList>
          <ListRow icon="bill" color="sun" title="Electricity" subtitle="Due · 2 Nov" amount="35.00 USDT" meta={<Badge tone="warning">Due</Badge>} />
          <ActivityRow icon="receive" title="From maya.oiko.near" subtitle="Split by your plan · 12:04" amount="200.00 USDT" direction="in" />
          <ActivityRow icon="agents" color="violet" title="To citypower.near" subtitle="Bills · Agent: Bill payer" amount="35.00 USDT" direction="out" flash />
          <ListRow icon="settings" color="stone" title="Interactive row" subtitle="With chevron" chevron onClick={() => toast.show({ message: "Row pressed" })} />
        </GroupedList>
        <SelectList label="Pick" value={sel} onChange={setSel} options={[{ value: 1, title: "USDT on TRON", icon: "bank" }, { value: 2, title: "USDC on Base", icon: "bank" }, { value: 3, title: "Disabled", icon: "lock", disabled: true }]} />
      </Block>

      <Block title="Inputs">
        <Input label="Your name" placeholder="ada" suffix=".oiko.near" hint="2 to 32 lowercase letters" />
        <Input label="Address" defaultValue="0x12" error="That doesn't look like an address." />
        <div className="oi-card"><AmountInput label="Amount" value={amt} onChange={setAmt} ticker="USDT" sub="120.50 USDT available" chips={[{ label: "Max", value: "120.5" }]} keypad="always" /></div>
        <CopyField label="Your pay link" value="https://oiko.app/pay/ada" mono={false} />
      </Block>

      <Block title="Tabs, segmented, toggle, mode badge">
        <Tabs label="Pots" value={tab} onChange={setTab} items={[{ value: "pots", label: "Pots" }, { value: "earn", label: "Earn" }, { value: "rosca", label: "ROSCA" }]} />
        <SegmentedControl label="Seg" value={seg} onChange={setSeg} items={[{ value: "a", label: "All" }, { value: "b", label: "In" }, { value: "c", label: "Out" }]} />
        <div className="oi-row"><Toggle checked={tog} onChange={setTog} label="Toggle" /><Toggle checked={false} onChange={() => {}} label="Off" disabled />
          <NetworkModeBadge mode="testnet" labels={{ local: "Local test mode", testnet: "Test mode" }} /></div>
      </Block>

      <Block title="Sheet, toast, hold to confirm">
        <div className="oi-row" style={{ flexWrap: "wrap" }}>
          <Button onClick={() => setSheet(true)}>Open sheet</Button>
          <Button variant="secondary" onClick={() => toast.show({ message: "Moved 25.00 USDT", tone: "success" })}>Toast</Button>
          <HoldToConfirm label="Hold to lock" doneLabel="Locked" onConfirm={() => toast.show({ message: "Locked", tone: "success" })} />
        </div>
        <Sheet open={sheet} onOpenChange={setSheet} title="Move money" footer={<Button block size="lg" onClick={() => setSheet(false)}>Confirm</Button>}>
          <p style={{ margin: 0, fontSize: 18 }}>Move 25.00 USDT from Spend to Laptop. Oiko charges no fee for this.</p>
        </Sheet>
      </Block>

      <Block title="Status timeline (cycles), circle timeline, QR">
        <div className="oi-card"><StatusTimeline label="Status" current={tl} steps={[{ key: "a", title: "Waiting for your payment" }, { key: "b", title: "Received" }, { key: "c", title: "Delivering" }, { key: "d", title: "Done" }]} liveText="" /></div>
        <div className="oi-card"><CircleTimeline label="Order" slots={[{ name: "maya", round: 0, state: "paid", caption: "3 Oct" }, { name: "You", round: 1, state: "current", caption: "10 Oct" }, { name: "sam", round: 2, state: "upcoming", caption: "17 Oct" }, { name: "lena", round: 3, state: "default", caption: "24 Oct" }]} /></div>
        <QRCodeCard value="https://oiko.app/pay/ada" label="QR" caption="Scan to pay ada" size={180} />
      </Block>

      <Block title="Agents: proposal, card with caps, scopes, access log, risk">
        <ProposalCard agentName="Money coach" agentLabel="Suggested by your agent" sentence="Put 25.00 USDT from Spend into Laptop." reason="You spent less on food this week." approveLabel="Approve" rejectLabel="Reject" onApprove={() => {}} onReject={() => {}} />
        <AgentCard name="Bill payer" subtitle="See · Suggest · Act · until 30 Nov" status={<Badge tone="success">Active</Badge>} disconnectLabel="Disconnect" onDisconnect={() => toast.show({ message: "Disconnected" })}
          caps={[{ label: "Today", used: 45, cap: 80, text: "45.00 of 80.00" }, { label: "This week", used: 101, cap: 120, text: "101.00 of 120.00" }]}>
          <ScopeList label="Permissions" items={[{ allowed: true, text: "See your balances" }, { allowed: true, text: "Pay only citypower.near" }, { allowed: false, text: "Open a locked pot" }]} />
          <AgentAccessLog label="Log" empty="No requests" rows={[{ at: "2026-10-30T10:00:00Z", atLabel: "30 Oct, 10:00", text: "pay_bill", detail: "ok" }, { at: "2026-10-30T09:00:00Z", atLabel: "30 Oct, 09:00", text: "pay · refused", detail: "E_AGENT_WEEKLY" }]} />
        </AgentCard>
        <RiskNote title="Before you turn this on" points={["The rate changes and can go to zero.", "Lending can fail."]} />
        <Note tone="info" title="Info note">Plain words.</Note>
      </Block>

      <Block title="Avatar, tile colours, empty, skeleton">
        <div className="oi-row" style={{ flexWrap: "wrap" }}>
          <Avatar name="Ada" /><Avatar name="Maya Chen" size={48} />
          {tileColors.map((c) => <Tile key={c} icon="star" color={c} />)}
        </div>
        <div className="oi-card"><EmptyState icon="bills" color="sun" title="No bills yet" body="Add rent, power or internet." action={<Button size="sm">Add bill</Button>} /></div>
        <Skeleton height={60} radius={20} />
      </Block>

      <Block title={`Icons (${Object.keys(icons).length} concepts)`}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))", gap: 8 }}>
          {(Object.keys(icons) as IconConcept[]).map((k) => (
            <div key={k} className="oi-card" style={{ padding: 10, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
              <Icon name={k} size={22} /><span className="oi-micro oi-muted">{k}</span>
            </div>
          ))}
        </div>
      </Block>

      <div style={{ position: "relative", height: 80 }}>
        <div style={{ position: "absolute", inset: 0, transform: "translateZ(0)" }}>
          <BottomTabBar label="Demo tabs" pathname="/home" items={[{ href: "#home", label: "Home", icon: "home" }, { href: "#plan", label: "Plan", icon: "plan" }, { href: "#pots", label: "Pots", icon: "pots" }, { href: "#agents", label: "Agents", icon: "agents" }, { href: "#more", label: "More", icon: "more" }]} />
        </div>
      </div>
    </div>
  );
}
