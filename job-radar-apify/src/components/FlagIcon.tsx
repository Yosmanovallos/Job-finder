// Real SVG flags instead of Unicode flag emoji (🇨🇴/🇻🇪). Flag emoji are
// two "regional indicator" code points that only render as an actual flag
// glyph when the OS/browser has a font that ligates them — Windows/Chrome
// commonly doesn't, and falls back to showing the two letters as plain
// text ("VE") instead. That's invisible in most chat UIs (which do render
// flags) but broke visibly in the country switcher, showing "VE VE" next
// to the country code. SVG renders identically everywhere.

import type { CSSProperties } from "react";

interface FlagProps {
  className?: string;
}

const FLAG_STYLE: CSSProperties = {
  display: "block",
  borderRadius: "2px",
  border: "1px solid rgba(14,15,16,0.12)"
};

export function FlagCO({ className }: FlagProps) {
  return (
    <svg viewBox="0 0 30 20" className={className} style={FLAG_STYLE} aria-hidden="true">
      <rect width="30" height="20" fill="#FCD116" />
      <rect width="30" height="10" y="10" fill="#003893" />
      <rect width="30" height="5" y="15" fill="#CE1126" />
    </svg>
  );
}

// Simplified: 8 stars in a straight row instead of the real flag's slight
// arc — imperceptible at the icon sizes this renders at (~16-20px wide).
export function FlagVE({ className }: FlagProps) {
  const starOffsets = [-8, -5.7, -3.4, -1.1, 1.1, 3.4, 5.7, 8];
  return (
    <svg viewBox="0 0 30 20" className={className} style={FLAG_STYLE} aria-hidden="true">
      <rect width="30" height="6.67" fill="#FFCC00" />
      <rect width="30" height="6.67" y="6.67" fill="#00247D" />
      <rect width="30" height="6.67" y="13.33" fill="#CF142B" />
      {starOffsets.map((dx, i) => (
        <circle key={i} cx={15 + dx} cy={9} r="0.9" fill="#ffffff" />
      ))}
    </svg>
  );
}

export function FlagIcon({ code, className }: { code: string } & FlagProps) {
  return code === "VE" ? <FlagVE className={className} /> : <FlagCO className={className} />;
}
