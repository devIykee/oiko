import type { SVGProps } from "react";
import { MARK_PATH, MARK_VIEWBOX, WORDMARK_PATH, WORDMARK_RATIO, WORDMARK_VIEWBOX } from "./paths";

type Variant = "mark" | "wordmark" | "lockup";
export interface LogoProps extends Omit<SVGProps<SVGSVGElement>, "height"> {
  variant?: Variant;
  /** Rendered height in px (width follows the artwork). */
  height?: number;
  /** Accessible name; pass "" when a visible label already names the link. */
  title?: string;
}

/**
 * Oiko logo, inline paths, fill = currentColor (set colour with CSS `color`).
 * mark: the gabled o. wordmark: "oiko" in outlined Acorn Bold with the gabled o. lockup: mark + wordmark.
 */
export function Logo({ variant = "wordmark", height = 24, title = "Oiko", ...rest }: LogoProps) {
  const a11y = title ? { role: "img" as const, "aria-label": title } : { "aria-hidden": true as const };
  if (variant === "mark") {
    return (
      <svg viewBox={MARK_VIEWBOX} height={height} width={height} fill="currentColor" {...a11y} {...rest}>
        <path fillRule="evenodd" d={MARK_PATH} />
      </svg>
    );
  }
  if (variant === "wordmark") {
    return (
      <svg viewBox={WORDMARK_VIEWBOX} height={height} width={Math.round(height * WORDMARK_RATIO * 10) / 10} fill="currentColor" {...a11y} {...rest}>
        <path fillRule="evenodd" d={WORDMARK_PATH} />
      </svg>
    );
  }
  // lockup: mark (scaled to wordmark height) + gap + wordmark, as one svg
  const [wx, wy, ww, wh] = WORDMARK_VIEWBOX.split(" ").map(Number);
  const gap = wh * 0.3;
  const s = wh / 24;
  return (
    <svg viewBox={`0 0 ${wh + gap + ww} ${wh}`} height={height} width={Math.round(height * ((wh + gap + ww) / wh) * 10) / 10} fill="currentColor" {...a11y} {...rest}>
      <path fillRule="evenodd" transform={`scale(${s})`} d={MARK_PATH} />
      <path fillRule="evenodd" transform={`translate(${wh + gap - wx} ${-wy})`} d={WORDMARK_PATH} />
    </svg>
  );
}
