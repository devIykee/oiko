// Custom Oiko glyphs (original, filled, 24-unit grid). Concepts not covered by framework7-icons:
// pay-by-name link, locked pot, agent with a budget, ajo circle.
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = (size = 24, props: SVGProps<SVGSVGElement>) => ({
  width: size, height: size, viewBox: "0 0 24 24", fill: "currentColor", "aria-hidden": true, focusable: false, ...props,
});

/** Pay link: a name tag with a link loop. */
export function PayLinkGlyph({ size, ...p }: P) {
  return (
    <svg {...base(size, p)}>
      <path fillRule="evenodd" d="M4 5.5A2.5 2.5 0 0 1 6.5 3h7.6c.66 0 1.3.26 1.77.73l4.4 4.4c.47.47.73 1.1.73 1.77V12h-2.6V10.4L14 6.4V9H6.6v2.6h6.2V14H6.6v3.4h6.2V20H6.5A2.5 2.5 0 0 1 4 17.5v-12Z" />
      <path d="M17.2 13.2a3.3 3.3 0 0 1 4.68 4.66l-1.45 1.45a3.3 3.3 0 0 1-4.67 0 1 1 0 0 1 1.41-1.41 1.3 1.3 0 0 0 1.84 0l1.45-1.45a1.3 1.3 0 1 0-1.84-1.84l-.3.3a1 1 0 0 1-1.41-1.41l.29-.3Zm-2.7 2.7a1 1 0 0 1 1.41 0 1 1 0 0 1 0 1.42l-1.45 1.44a1.3 1.3 0 0 0 1.84 1.84l.3-.3a1 1 0 1 1 1.41 1.42l-.3.3a3.3 3.3 0 0 1-4.66-4.67l1.45-1.45Z" />
    </svg>
  );
}

/** Locked pot: a rounded jar body with a padlock shackle as its lid. */
export function LockedPotGlyph({ size, ...p }: P) {
  return (
    <svg {...base(size, p)}>
      <path fillRule="evenodd" d="M8 7.5V6a4 4 0 1 1 8 0v1.5h-2.4V6a1.6 1.6 0 1 0-3.2 0v1.5H8Z" />
      <path fillRule="evenodd" d="M5.5 8.5h13A2.5 2.5 0 0 1 21 11v7.5a3.5 3.5 0 0 1-3.5 3.5h-11A3.5 3.5 0 0 1 3 18.5V11a2.5 2.5 0 0 1 2.5-2.5Zm6.5 4a1.8 1.8 0 0 0-1 3.3V18a1 1 0 1 0 2 0v-2.2a1.8 1.8 0 0 0-1-3.3Z" />
    </svg>
  );
}

/** Agent with a budget: a rounded bot head with a cap gauge beneath. */
export function AgentBudgetGlyph({ size, ...p }: P) {
  return (
    <svg {...base(size, p)}>
      <path d="M11 2.6a1 1 0 1 1 2 0V4h3.5A3.5 3.5 0 0 1 20 7.5v5a3.5 3.5 0 0 1-3.5 3.5h-9A3.5 3.5 0 0 1 4 12.5v-5A3.5 3.5 0 0 1 7.5 4H11V2.6Zm-2 6.4a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm6 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z" fillRule="evenodd" />
      <path d="M4 19.5A1.5 1.5 0 0 1 5.5 18h13a1.5 1.5 0 0 1 0 3h-13A1.5 1.5 0 0 1 4 19.5Z" opacity=".35" />
      <path d="M4 19.5A1.5 1.5 0 0 1 5.5 18H14v3H5.5A1.5 1.5 0 0 1 4 19.5Z" />
    </svg>
  );
}

/** Ajo circle: four members around a ring passing a coin. */
export function AjoCircleGlyph({ size, ...p }: P) {
  return (
    <svg {...base(size, p)}>
      <circle cx="12" cy="4" r="2.6" />
      <circle cx="20" cy="12" r="2.6" />
      <circle cx="12" cy="20" r="2.6" />
      <circle cx="4" cy="12" r="2.6" />
      <circle cx="12" cy="12" r="3.2" />
      <path d="M15.6 5.3a8.4 8.4 0 0 1 3.1 3.1l-1.7 1A6.4 6.4 0 0 0 14.6 7l1-1.7ZM8.4 18.7a8.4 8.4 0 0 1-3.1-3.1l1.7-1A6.4 6.4 0 0 0 9.4 17l-1 1.7ZM5.3 8.4a8.4 8.4 0 0 1 3.1-3.1l1 1.7A6.4 6.4 0 0 0 7 9.4l-1.7-1ZM18.7 15.6a8.4 8.4 0 0 1-3.1 3.1l-1-1.7a6.4 6.4 0 0 0 2.4-2.4l1.7 1Z" />
    </svg>
  );
}
