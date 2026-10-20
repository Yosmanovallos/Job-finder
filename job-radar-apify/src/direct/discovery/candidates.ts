import { z } from "zod";
import { COMPANY_LOGO_DOMAINS } from "../../data/company-logo-domains.js";
import { companyKey, isPlaceholderKey } from "./company-key.js";
import type { DiscoveryCandidate } from "./probe.js";

/**
 * Builds discovery candidates from the directory (docs/adr/0006-direct-employers.md
 * §7.1). The only domain source with evidence today is the hand-verified
 * logo map; a candidate without one is probed by name only — no domain is
 * ever guessed here.
 */

export const CURATED_DOMAIN_ORIGIN = "curated_logo_map";

const AgencyFile = z.object({ agencies: z.array(z.string().min(1)) });

export function parseAgencyKeys(json: unknown): Set<string> {
  return new Set(AgencyFile.parse(json).agencies.map(companyKey).filter((key) => key.length > 0));
}

/** company_key -> verified domain, from COMPANY_LOGO_DOMAINS (raw spellings folded to keys). */
export function curatedDomains(map: Record<string, string> = COMPANY_LOGO_DOMAINS): Map<string, string> {
  const domains = new Map<string, string>();
  const conflicting = new Set<string>();
  for (const [name, domain] of Object.entries(map)) {
    const key = companyKey(name);
    const existing = domains.get(key);
    if (existing && existing !== domain) conflicting.add(key);
    domains.set(key, domain.toLowerCase());
  }
  // Two domains for one key: neither is evidence.
  for (const key of conflicting) domains.delete(key);
  return domains;
}

export interface DirectoryEntry {
  companyKey: string;
  companyName: string;
  directoryCount: number;
}

/** Directory entries as candidates: placeholders dropped, one per key, agencies flagged, curated domain attached. */
export function toCandidates(entries: DirectoryEntry[], agencyKeys: Set<string>, domains: Map<string, string>): (DiscoveryCandidate & { domainOrigin: string | null })[] {
  const byKey = new Map<string, DirectoryEntry>();
  for (const entry of entries) {
    if (!entry.companyKey || isPlaceholderKey(entry.companyKey)) continue;
    const existing = byKey.get(entry.companyKey);
    if (!existing) byKey.set(entry.companyKey, { ...entry });
    else existing.directoryCount += entry.directoryCount;
  }
  return [...byKey.values()].map((entry) => {
    const domain = domains.get(entry.companyKey) ?? null;
    return {
      ...entry,
      websiteDomain: domain,
      domainOrigin: domain ? CURATED_DOMAIN_ORIGIN : null,
      isAgency: agencyKeys.has(entry.companyKey)
    };
  });
}

const SnapshotFile = z.array(z.object({ company: z.string().min(1), count: z.number().int().nonnegative() }).passthrough());

/** A saved /api/companies/search page set ([{company, count}]) as directory entries — for local runs. */
export function parseDirectorySnapshot(json: unknown): DirectoryEntry[] {
  return SnapshotFile.parse(json).map((row) => ({ companyKey: companyKey(row.company), companyName: row.company.trim(), directoryCount: row.count }));
}
