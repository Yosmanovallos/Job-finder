import { useState } from "react";
import { cn } from "../lib/utils.js";

function initialFor(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

interface CompanyAvatarProps {
  name: string;
  // From company-logo-domains.ts's curated map (via the API) — null for
  // the vast majority of companies, which keep the existing initial.
  logoUrl: string | null;
  // Size + font-size utility classes only (e.g. "w-11 h-11 text-lg") —
  // shape/color/layout stay fixed here so both render states match.
  className?: string;
}

// Shared by CompaniesDirectory.tsx and CompanyLanding.tsx so the curated
// real logo and its initial-avatar fallback stay in exactly one place.
// JobCard.tsx's feed avatar is deliberately NOT switched to this — it
// covers the full uncurated corpus, where no domain is verified (see its
// own comment on why guessing one is unsafe).
export function CompanyAvatar({ name, logoUrl, className }: CompanyAvatarProps) {
  const [failed, setFailed] = useState(false);

  if (logoUrl && !failed) {
    return (
      <img
        src={logoUrl}
        alt=""
        onError={() => setFailed(true)}
        className={cn(
          "shrink-0 rounded-lg object-contain bg-white border border-border p-1.5",
          className
        )}
      />
    );
  }

  return (
    <div
      className={cn(
        "shrink-0 rounded-lg bg-gradient-to-br from-gold-1 to-gold-2 text-gold-ink font-heading font-semibold flex items-center justify-center",
        className
      )}
    >
      {initialFor(name)}
    </div>
  );
}
