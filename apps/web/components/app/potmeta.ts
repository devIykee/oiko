import { asTileColor, potIcon, type IconConcept, type TileColor } from "@oiko/ui";
import type { Pot } from "@oiko/sdk";
import type { TFn } from "@/lib/i18n";
import { nsToMs } from "@/lib/format";

export const potColor = (p: Pot): TileColor => asTileColor(p.color);
export const potGlyph = (p: Pot): IconConcept => potIcon(p.icon, p.kind);
/** Contract kind flex/autosave are shown as Spend/Savings. */
export const potName = (p: Pot, t: TFn) => (p.kind === "flex" ? t("pot.kind.flex") : p.name);
export const isLocked = (p: Pot, nowMs = Date.now()) => !!p.unlock_at && nsToMs(p.unlock_at) > nowMs;
export const potById = (pots: Pot[], id: number | null | undefined) => pots.find((p) => p.id === id);
