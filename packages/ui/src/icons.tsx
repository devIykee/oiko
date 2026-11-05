// One glyph per concept. Framework7 Icons (MIT) `_fill` variants for actions/tiles/pots;
// outline only for small inline UI. Custom glyphs for pay link, locked pot, agent budget, ajo.
import type { CSSProperties, SVGProps } from "react";
import { glyphs, type GlyphName } from "./icons/glyphs";
import { AgentBudgetGlyph, AjoCircleGlyph, LockedPotGlyph, PayLinkGlyph } from "./icons/custom";

const custom = {
  payLink: PayLinkGlyph,
  lockedPot: LockedPotGlyph,
  agentBudget: AgentBudgetGlyph,
  ajo: AjoCircleGlyph,
} as const;
type CustomName = keyof typeof custom;

export const icons = {
  // navigation
  home: "house_fill",
  plan: "chart_pie_fill",
  bills: "doc_text_fill",
  pots: "square_grid_2x2_fill",
  insights: "chart_bar_fill",
  agents: "agentBudget",
  activity: "clock_fill",
  settings: "gear_alt_fill",
  more: "ellipsis_circle_fill",
  // round actions
  receive: "arrow_down",
  withdraw: "arrow_up",
  move: "arrow_right_arrow_left",
  moreAction: "ellipsis",
  add: "plus",
  remove: "minus",
  // pots (by kind / icon key)
  spend: "creditcard_fill",
  savings: "tray_fill",
  bill: "doc_text_fill",
  locked: "lockedPot",
  goal: "flag_fill",
  rainy: "umbrella_fill",
  travel: "airplane",
  car: "car_fill",
  school: "book_fill",
  gift: "gift_fill",
  health: "heart_fill",
  shopping: "bag_fill",
  food: "cart_fill",
  work: "briefcase_fill",
  power: "bolt_fill",
  water: "drop_fill",
  phone: "phone_fill",
  internet: "wifi",
  tv: "tv_fill",
  rent: "house_alt_fill",
  star: "star_fill",
  earn: "graph_square_fill",
  ajo: "ajo",
  invest: "cube_fill",
  // people & identity
  person: "person_fill",
  people: "person_2_fill",
  avatar: "person_crop_circle_fill",
  payLink: "payLink",
  // status
  check: "checkmark_alt",
  success: "checkmark_circle_fill",
  close: "xmark",
  error: "xmark_circle_fill",
  warning: "exclamationmark_triangle_fill",
  info: "info_circle_fill",
  infoInline: "info_circle",
  lock: "lock_fill",
  unlock: "lock_open_fill",
  shield: "checkmark_shield_fill",
  security: "lock_shield_fill",
  pending: "hourglass",
  timer: "timer_fill",
  bell: "bell_fill",
  proposal: "hand_raised_fill",
  disconnect: "power",
  // utilities
  copy: "doc_on_doc",
  share: "square_arrow_up",
  qr: "qrcode",
  link: "link",
  chevronRight: "chevron_right",
  chevronLeft: "chevron_left",
  chevronDown: "chevron_down",
  edit: "pencil",
  delete: "trash_fill",
  language: "globe",
  dark: "moon_fill",
  light: "sun_max_fill",
  refresh: "arrow_2_circlepath",
  calendar: "calendar",
  show: "eye_fill",
  hide: "eye_slash_fill",
  send: "paperplane_fill",
  external: "arrow_up_right",
  search: "search",
  list: "list_bullet",
  keypadDelete: "delete_left_fill",
  export: "arrow_down_doc_fill",
  bank: "building_2_fill",
  message: "chat_bubble_fill",
  dot: "circle_fill",
} as const satisfies Record<string, GlyphName | CustomName>;

export type IconConcept = keyof typeof icons;

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconConcept;
  /** 22 in 48px round actions, 18 in 36px tiles, 17 inline (default). */
  size?: number;
  /** Accessible label; when omitted the icon is decorative. */
  label?: string;
  style?: CSSProperties;
}

export function Icon({ name, size = 17, label, ...rest }: IconProps) {
  const key = icons[name] as GlyphName | CustomName;
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true as const };
  if (key in custom) {
    const C = custom[key as CustomName];
    return <C size={size} {...rest} {...a11y} />;
  }
  const g = glyphs[key as GlyphName];
  return (
    <svg
      width={size}
      height={size}
      viewBox={g.vb}
      fill="currentColor"
      focusable={false}
      {...a11y}
      {...rest}
      dangerouslySetInnerHTML={{ __html: g.body }}
    />
  );
}

/** Map a pot's stored icon key (free string from the contract) to a concept. */
export function potIcon(icon: string | null | undefined, kind?: string): IconConcept {
  if (icon && icon in icons) return icon as IconConcept;
  switch (kind) {
    case "flex": return "spend";
    case "autosave": return "savings";
    case "bills": return "bill";
    case "locked": return "locked";
    case "goal": return "goal";
    default: return "star";
  }
}

export const tileColors = ["blue", "violet", "mint", "sun", "rose", "stone"] as const;
export type TileColor = (typeof tileColors)[number];
export function asTileColor(c: string | null | undefined): TileColor {
  return (tileColors as readonly string[]).includes(c ?? "") ? (c as TileColor) : "blue";
}
