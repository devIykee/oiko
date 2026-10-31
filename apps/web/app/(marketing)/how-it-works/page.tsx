import type { Metadata } from "next";
import Link from "next/link";
import { Block, PageHero } from "@/components/marketing/Prose";
import { PillLink } from "@/components/marketing/ui";

export const metadata: Metadata = {
  title: "How it works",
  description: "Get paid by name from anywhere, let your plan split every payment into pots, and let your own AI agent help on limits you set.",
};

const steps: Array<[string, string]> = [
  ["Claim your name", "Pick a name like ada. In under a minute Oiko creates ada.oiko.near (your identity, with your keys on your device) and your account, vault.ada.oiko.near, where your money lives. No seed phrase to write down."],
  ["Share your pay link", "Anyone can pay /pay/ada. They choose where their money is now, for example USDT on TRON or USDC on Base, and get an address and exact amount. NEAR Intents converts it and delivers USDC or USDT to your account."],
  ["Your plan runs", "When money arrives it is split by your plan into pots: Spend for now, Bills, Savings, Goals, and Locked pots that only open on their date. Payments are noticed even if nobody pressed a button: anyone can ask the account to sync, and it is safe to ask twice."],
  ["Pay, save, withdraw", "Pay bills, move between pots, or withdraw from Spend to an exchange or another account. Every money action shows the amount, the source pot, where it goes and the fees in one sentence before you confirm."],
  ["Let your agent help", "Connect the AI agent you already use through MCP or the REST API. It gets its own limited key: read only, suggest only, or act within caps and payees you choose. Disconnect revokes it at once."],
];

export default function HowItWorks() {
  return (
    <>
      <PageHero eyebrow="How it works" title="From payday to plan, without the managing." lead="Oiko is a personal finance app built on USDC and USDT stablecoins on NEAR. You never need to know that to use it, but here is how it fits together." />
      {steps.map(([t, b], i) => (
        <Block key={t} title={`${i + 1}. ${t}`} tone={i % 2 ? "grey" : "white"}>
          <p>{b}</p>
        </Block>
      ))}
      <Block title="What runs where" tone="grey">
        <p><strong>On NEAR:</strong> your name, your account and its rules (pots, plan, locks, caps, bills, ajo circles). <strong>In your browser:</strong> your keys. <strong>On Oiko&rsquo;s servers:</strong> a relayer that pays transaction fees for you, the pay-link service and the agent gateway. None of them can move your money.</p>
        <p>Read the <Link className="font-semibold text-accent hover:underline" href="/security">Trust page</Link> for code fingerprints, contract accounts and risks.</p>
        <div className="flex flex-wrap gap-3 pt-2">
          <PillLink href="/start" variant="accent">Get your name</PillLink>
          <PillLink href="/home" variant="secondary">Open app</PillLink>
        </div>
      </Block>
    </>
  );
}
