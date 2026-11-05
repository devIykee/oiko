import { agents } from "./en/agents";
import { bills } from "./en/bills";
import { common } from "./en/common";
import { connect } from "./en/connect";
import { flows } from "./en/flows";
import { home } from "./en/home";
import { insights } from "./en/insights";
import { invoices } from "./en/invoices";
import { misc } from "./en/misc";
import { pay } from "./en/pay";
import { plan } from "./en/plan";
import { earn2, pots } from "./en/pots";
import { rosca } from "./en/rosca";
import { receive } from "./en/receive";
import { settings } from "./en/settings";
import { start } from "./en/start";
import { withdraw } from "./en/withdraw";

export const en = {
  ...common, ...flows, ...home, ...pots, ...earn2, ...rosca, ...receive, ...withdraw, ...plan, ...bills, ...insights,
  ...agents, ...misc, ...settings, ...start, ...pay, ...connect, ...invoices,
} as const;
export type MessageKey = keyof typeof en;
