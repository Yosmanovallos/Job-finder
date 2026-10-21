import { z } from "zod";
import { isValidRef, portalUrl } from "./connectors.js";
import { DIRECT_ATS_TYPES } from "./types.js";
import type { EmployerSeed } from "../db/direct-repository.js";

/** Shape of data/direct-employers.seed.json (references only — no postings). */
const SeedFile = z.object({
  employers: z.array(
    z
      .object({
        slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
        displayName: z.string().min(1).max(255),
        websiteDomain: z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/).nullable(),
        aliases: z.array(z.string().min(1).max(255)),
        sources: z
          .array(
            z
              .object({
                atsType: z.enum(DIRECT_ATS_TYPES),
                // Each connector checks its own ref format (Workday refs carry
                // slashes, Eightfold refs an @) — see parseEmployerSeed.
                atsRef: z.string().min(1).max(200),
                enabled: z.boolean()
              })
              .strict()
          )
          .min(1)
      })
      .strict()
  )
});

export function parseEmployerSeed(json: unknown): EmployerSeed[] {
  const parsed = SeedFile.parse(json);
  const slugs = new Set<string>();
  const boards = new Set<string>();
  for (const employer of parsed.employers) {
    if (slugs.has(employer.slug)) throw new Error(`slug repetido en el seed: ${employer.slug}`);
    slugs.add(employer.slug);
    for (const source of employer.sources) {
      const board = `${source.atsType}:${source.atsRef}`;
      if (!isValidRef(source)) throw new Error(`ats_ref inválido para ${source.atsType}: ${source.atsRef}`);
      if (boards.has(board)) throw new Error(`tablero repetido en el seed: ${board}`);
      boards.add(board);
    }
  }
  return parsed.employers.map((employer) => ({
    slug: employer.slug,
    displayName: employer.displayName,
    websiteDomain: employer.websiteDomain,
    origin: "seed",
    aliases: employer.aliases,
    sources: employer.sources.map((source) => ({ ...source, portalUrl: portalUrl(source) }))
  }));
}
