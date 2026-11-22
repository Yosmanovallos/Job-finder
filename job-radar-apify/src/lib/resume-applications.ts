import { z } from "zod";
import { resumeFactsSchema, type ResumeFacts } from "./resume-studio.js";

// AI Resume Studio R4b — «Mis postulaciones» (doc 11 §5.1). Pure: the
// browser uses the labels and the server the schemas. Free for everyone:
// nothing here knows about passes. The status is what the USER says; the
// product never applies or contacts anyone (AGENTS.md rule 7).

export const APPLICATION_STATUSES = ["saved", "applied", "interview", "offer", "discarded"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  saved: "Guardada",
  applied: "Postulé",
  interview: "Entrevista",
  offer: "Oferta",
  discarded: "Descartada"
};

/** Rows per user: the board stays bounded. */
export const APPLICATIONS_MAX_PER_USER = 200;
export const APPLICATION_NOTE_MAX = 280;
export const APPLICATION_URL_MAX = 2000;

const text = (max: number) =>
  z
    .string()
    .max(max * 4)
    .transform((value) => value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim())
    .pipe(z.string().max(max));

/** Only http(s), no credentials — it ends up in an href. */
export const applicationUrlSchema = z
  .string()
  .trim()
  .max(APPLICATION_URL_MAX)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password;
    } catch {
      return false;
    }
  }, "Enlace no válido.");

const score = z.number().int().min(0).max(100);
const uuid = z.string().uuid();

export const applicationCreateSchema = z
  .object({
    job: z
      .object({
        title: text(200).pipe(z.string().min(1, "Falta el cargo.")),
        company: text(200).nullable().optional(),
        url: applicationUrlSchema.nullable().optional()
      })
      .strict(),
    status: z.enum(APPLICATION_STATUSES).optional(),
    note: text(APPLICATION_NOTE_MAX).optional(),
    adaptationId: uuid.nullable().optional(),
    resumeId: uuid.nullable().optional(),
    resumeVersionNo: z.number().int().min(1).nullable().optional(),
    scoreBefore: score.nullable().optional(),
    scoreAfter: score.nullable().optional(),
    facts: resumeFactsSchema.nullable().optional()
  })
  .strict();
export type ApplicationCreate = z.infer<typeof applicationCreateSchema>;

export const applicationUpdateSchema = z
  .object({
    status: z.enum(APPLICATION_STATUSES).optional(),
    note: text(APPLICATION_NOTE_MAX).optional()
  })
  .strict()
  .refine((value) => value.status !== undefined || value.note !== undefined, "Nada que cambiar.");
export type ApplicationUpdate = z.infer<typeof applicationUpdateSchema>;

/**
 * The same vacancy is one card: «Guardar» after an adaptation and «Marcar
 * como postulé» from the link land on the same row. Host lower-case, no
 * fragment, no trailing slash.
 */
export function canonicalApplicationUrl(value: string): string {
  const url = new URL(value.trim());
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  let out = url.toString();
  if (out.endsWith("/") && url.pathname !== "/") out = out.slice(0, -1);
  return out;
}

/** True once the process reached «Postulé» or beyond (keeps applied_at). */
export function isAppliedOrLater(status: ApplicationStatus): boolean {
  return status === "applied" || status === "interview" || status === "offer";
}

export interface ApplicationSummary {
  id: string;
  job: { title: string; company: string | null; url: string | null };
  status: ApplicationStatus;
  note: string;
  adaptationId: string | null;
  resumeId: string | null;
  resumeVersionNo: number | null;
  scoreBefore: number | null;
  scoreAfter: number | null;
  hasCv: boolean;
  appliedAt: string | null;
  statusChangedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface Application extends ApplicationSummary {
  facts: ResumeFacts | null;
}
