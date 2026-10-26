import { useState } from "react";
import { getSourceColor } from "../lib/source-colors.js";
import { getSourceLogoUrl } from "../lib/source-logos.js";

// Portal logo for source chips (homepage marquee, /fuentes). Falls back to
// the portal's initial on its badge color when the favicon can't load.
export function SourceLogo({ source, lazy = false }: { source: string; lazy?: boolean }) {
  const [failed, setFailed] = useState(false);
  const url = getSourceLogoUrl(source);
  const color = getSourceColor(source.replace(/ Jobs$/, ""));
  if (url && !failed) {
    return (
      <img
        src={url}
        alt=""
        width={28}
        height={28}
        decoding="async"
        loading={lazy ? "lazy" : undefined}
        onError={() => setFailed(true)}
        className="w-6 h-6 md:w-7 md:h-7 rounded-md object-contain bg-white"
      />
    );
  }
  return (
    <span aria-hidden="true" className="w-6 h-6 md:w-7 md:h-7 rounded-md grid place-items-center text-xs font-bold text-white" style={{ backgroundColor: color.text }}>
      {source.charAt(0)}
    </span>
  );
}
