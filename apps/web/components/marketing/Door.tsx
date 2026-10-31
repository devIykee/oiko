// Closing illustration: an open front door with a small coin on the step. Original, flat, monochrome line art.
// The roof echoes the gabled o of the logo.
export function Door({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 1200 380" className={className} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label="An open front door with a small coin on the step">
      {/* ground */}
      <path d="M24 340H1176" />
      {/* house: walls and gable roof with eaves */}
      <path d="M420 340V170" />
      <path d="M780 340V170" />
      <path d="M392 186L600 52L808 186" />
      {/* chimney */}
      <path d="M700 116V84H732V136" />
      {/* doorway, with dark interior (open) */}
      <path d="M548 340V214A8 8 0 0 1 556 206H644A8 8 0 0 1 652 214V340" />
      <path d="M574 222H644V340H574Z" fill="currentColor" stroke="none" />
      {/* the door leaf, swung inward on its left hinge (seen edge-on, in perspective) */}
      <path d="M556 214L574 222V340L556 340Z" />
      <path d="M567 280V286" strokeWidth="4" />
      {/* step */}
      <path d="M528 340V352H672V340" />
      {/* light spilling out onto the path */}
      <path d="M574 352L540 376M644 352L678 376" strokeDasharray="1 7" />
      {/* the coin on the step */}
      <ellipse cx="626" cy="333" rx="11" ry="6" />
      <path d="M615 333V336A11 6 0 0 0 637 336V333" />
      {/* window */}
      <rect x="690" y="226" width="56" height="56" rx="6" />
      <path d="M718 226V282M690 254H746" />
      {/* round window in the gable: an o */}
      <circle cx="600" cy="138" r="18" />
      {/* plant by the door */}
      <path d="M480 340V300M480 312C470 304 464 294 464 282M480 306C490 298 496 288 496 276" />
      {/* bushes */}
      <path d="M150 340C150 320 166 308 184 308C196 296 222 296 234 310C252 308 266 322 264 340" />
      <path d="M930 340C930 324 944 314 958 316C968 304 990 304 998 318C1012 318 1022 328 1020 340" />
    </svg>
  );
}
