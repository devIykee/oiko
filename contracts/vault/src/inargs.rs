//! JSON argument converters for the vault's composite input types (see oiko_common::args).
use crate::types::*;
use near_sdk::json_types::{U128, U64};
use oiko_common::args::Jv;
use oiko_common::fail;

fn bad(m: &str) -> ! {
    fail("E_BAD_ARGS", m)
}

pub fn pot_kind(j: &Jv) -> PotKind {
    match j.str() {
        "flex" => PotKind::Flex,
        "autosave" => PotKind::Autosave,
        "locked" => PotKind::Locked,
        "goal" => PotKind::Goal,
        "bills" => PotKind::Bills,
        _ => bad("unknown pot kind"),
    }
}

pub fn rules(j: &Jv) -> Vec<SplitRule> {
    j.arr()
        .iter()
        .map(|r| SplitRule {
            pot_id: r.req("pot_id").u32(),
            mode: match r.req("mode").str() {
                "percent" => SplitMode::Percent,
                "fixed" => SplitMode::Fixed,
                _ => bad("mode must be percent or fixed"),
            },
            value: U128(r.req("value").dec()),
        })
        .collect()
}

pub fn recipient(j: &Jv) -> Recipient {
    match j.req("type").str() {
        "near" => Recipient::Near { account_id: j.req("account_id").account() },
        "intents" => Recipient::Intents {
            chain: j.req("chain").string(),
            address: j.req("address").string(),
            token: j.req("token").token(),
        },
        _ => bad("unknown recipient type"),
    }
}

pub fn action(j: &Jv) -> AgentAction {
    match j.req("type").str() {
        "pay" => AgentAction::Pay {
            token: j.req("token").token(),
            amount: U128(j.req("amount").dec()),
            to: j.req("to").account(),
            memo: j.opt("memo").map(|m| m.string()),
        },
        "pay_bill" => AgentAction::PayBill { bill_id: j.req("bill_id").u32() },
        "move" => AgentAction::Move {
            from_pot: j.req("from_pot").u32(),
            to_pot: j.req("to_pot").u32(),
            token: j.req("token").token(),
            amount: U128(j.req("amount").dec()),
        },
        "save" => AgentAction::Save {
            to_pot: j.req("to_pot").u32(),
            token: j.req("token").token(),
            amount: U128(j.req("amount").dec()),
        },
        _ => bad("unknown action type"),
    }
}

pub fn policy(j: &Jv) -> AgentPolicyInput {
    AgentPolicyInput {
        label: j.req("label").string(),
        agent_name: j.req("agent_name").string(),
        agent_url: j.req("agent_url").string(),
        scopes: j
            .req("scopes")
            .arr()
            .iter()
            .map(|s| match s.str() {
                "read" => Scope::Read,
                "propose" => Scope::Propose,
                "act" => Scope::Act,
                _ => bad("unknown scope"),
            })
            .collect(),
        allowed_actions: j
            .req("allowed_actions")
            .arr()
            .iter()
            .map(|s| match s.str() {
                "pay" => AgentKind::Pay,
                "move_between_pots" => AgentKind::MoveBetweenPots,
                "save" => AgentKind::Save,
                _ => bad("unknown agent action kind"),
            })
            .collect(),
        allowlist: j.req("allowlist").arr().iter().map(recipient).collect(),
        per_tx: U128(j.req("per_tx").dec()),
        daily: U128(j.req("daily").dec()),
        weekly: U128(j.req("weekly").dec()),
        expires_at: U64(j.req("expires_at").dec64()),
    }
}

pub fn config(j: &Jv) -> Config {
    Config {
        max_utilization_bps: j.req("max_utilization_bps").u16(),
        large_withdrawal_threshold: U128(j.req("large_withdrawal_threshold").dec()),
        lending: j.opt("lending").map(|x| x.account()),
        ajo: j.opt("ajo").map(|x| x.account()),
        mpc_signer: j.opt("mpc_signer").map(|x| x.account()),
        agent_allowance: U128(j.req("agent_allowance").dec()),
    }
}
