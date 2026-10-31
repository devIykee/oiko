import type { Metadata } from "next";
import { Block, PageHero } from "@/components/marketing/Prose";
import { TrustLive } from "@/components/marketing/TrustLive";

export const metadata: Metadata = {
  title: "Trust and security",
  description: "How Oiko keeps your money in an account only you control: no admin keys, unbreakable locks, agent limits enforced on-chain, and the risks in plain words.",
};

function Custody() {
  // Flat custody diagram: who can do what.
  const box = "rounded-[16px] bg-surface p-4 text-[14px]";
  return (
    <figure className="rounded-card bg-bg p-5 md:p-6" aria-labelledby="custody-cap">
      <div className="grid gap-3 md:grid-cols-3 md:items-stretch">
        <div className={box}>
          <p className="font-semibold text-ink">You</p>
          <p className="mt-1 text-ink-2">ada.oiko.near holds your keys, on your device (passkey).</p>
        </div>
        <div className={`${box} border-2 border-accent`}>
          <p className="font-semibold text-ink">Your account</p>
          <p className="mt-1 text-ink-2">vault.ada.oiko.near holds the money. It has no keys of its own and its code cannot be changed.</p>
        </div>
        <div className={box}>
          <p className="font-semibold text-ink">Your agents</p>
          <p className="mt-1 text-ink-2">Each gets a limited key the account added itself: caps, payees, expiry. Revocable at once.</p>
        </div>
      </div>
      <figcaption id="custody-cap" className="mt-4 text-[14px] text-ink-2">Oiko, the company, is not in this picture. Our servers only relay transactions you already signed and help with names.</figcaption>
    </figure>
  );
}

export default function SecurityPage() {
  return (
    <>
      <PageHero eyebrow="Trust and security" title="Your money, in an account only you control." lead="Oiko runs on USDC and USDT stablecoins on NEAR. Here is exactly who can do what, the code you can check, and the risks in plain words." />
      <Block title="Who holds the money">
        <p>Your name, like <strong>ada.oiko.near</strong>, is your identity account. It holds your keys. Your money lives in a separate account, <strong>vault.ada.oiko.near</strong>, which has <strong>no access keys</strong>: nobody can sign for it directly, including Oiko. It only follows the rules in its code, on instructions signed by you or by an agent you allowed.</p>
        <Custody />
      </Block>
      <Block id="code" title="Code you can check" tone="grey">
        <p>Every account runs the same published code. There is no upgrade method and no admin key. The fingerprint below is read live from the deployment.</p>
        <TrustLive />
      </Block>
      <Block id="locks" title="Locks only the date can open">
        <p>When you lock a pot until a date, the account code refuses every withdrawal from it before that date. There is no override: <strong>not you, not Oiko, nobody</strong>. You can extend a lock, never shorten it.</p>
      </Block>
      <Block id="agents" title="Agent limits and revoke" tone="grey">
        <p>Oiko has no built-in AI. When you connect your own agent, your account adds a key that can only call Oiko&rsquo;s agent methods, never transfer freely. The account checks every request against the limits you set: what it may read, whether it may only suggest or also act, per-payment, daily and weekly caps, the payees it may pay, and an expiry.</p>
        <p>Every request is written to an access log you can read. <strong>Disconnect</strong> deletes the agent&rsquo;s key from your account immediately. Oiko cannot verify who runs an agent, so only connect agents you trust.</p>
      </Block>
      <Block id="earn" title="Earn safeguard">
        <p>Earn is off by default. If you switch it on, that pot is lent on the Rhea lending market. Before lending, your account checks how much of the pool is already borrowed and refuses above 92% (never configurable above 95%), so you can usually take money back out. This is a safeguard, not a guarantee.</p>
      </Block>
      <Block id="risks" title="Risks in plain words" tone="grey">
        <ul className="list-disc space-y-3 pl-5">
          <li><strong>Stablecoins are not dollars.</strong> USDC and USDT are stablecoins designed to track the US dollar. They are not dollars and are not bank deposits. They can lose their peg and issuers can freeze them.</li>
          <li><strong>Not a bank, not insured.</strong> Nobody insures your balance.</li>
          <li><strong>Smart contract risk.</strong> Bugs in Oiko&rsquo;s code or in the contracts it uses (stablecoins, lending) could lose money. Because the account code cannot be upgraded, a bug cannot be patched in place.</li>
          <li><strong>Yields are variable</strong> and can go to zero. Lending can be paused or run out of room.</li>
          <li><strong>Your device matters.</strong> If you lose every way to sign in and your recovery options, nobody can recover the money for you.</li>
          <li><strong>Agents can be wrong.</strong> An agent can make bad choices inside the limits you gave it. Keep caps small.</li>
        </ul>
        <p>Oiko is not a bank. Balances are not insured. Yields are variable and can go to zero. Stablecoins carry issuer risk. Not investment, legal or tax advice.</p>
      </Block>
    </>
  );
}
