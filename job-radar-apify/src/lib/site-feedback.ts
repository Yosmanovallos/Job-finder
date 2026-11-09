// "Opiniones y ayuda" (/opiniones): the rules shared by the form and the
// POST /api/feedback handler. No JSX here: server.ts imports it.
//
// Two kinds of message, one table (schema.sql's site-feedback block):
// - problem: a private bug report. Never published, never indexed.
// - opinion: public once someone on the team publishes it by hand. Stored
//   as "pending"; nothing is published automatically.
// No email and no IP are stored. Page, search and browser are stored only
// when the person ticks the "adjuntar datos técnicos" box.

export const FEEDBACK_KINDS = ["problem", "opinion"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export const PROBLEM_CATEGORIES = [
  { id: "no-carga", label: "No cargó la página" },
  { id: "busqueda", label: "La búsqueda dio error" },
  { id: "vacante", label: "Una oferta no abre o ya cerró" },
  { id: "lento", label: "Va muy lento" },
  { id: "cuenta", label: "Problema con mi cuenta" },
  { id: "otro", label: "Otra cosa" }
] as const;

export const OPINION_CATEGORIES = [
  { id: "encontre-trabajo", label: "Encontré trabajo" },
  { id: "me-sirvio", label: "Me sirvió" },
  { id: "sugerencia", label: "Tengo una sugerencia" },
  { id: "no-me-sirvio", label: "No me sirvió" }
] as const;

export const FEEDBACK_LIMITS = {
  message: 2000,
  opinionMessageMin: 10,
  name: 60,
  city: 60,
  pagePath: 300,
  search: 200,
  userAgent: 300
} as const;

// Small on purpose: a 2000-char message plus a few short fields.
export const FEEDBACK_BODY_MAX_BYTES = 8 * 1024;

export interface FeedbackInput {
  kind: FeedbackKind;
  category: string;
  message: string;
  displayName: string | null;
  city: string | null;
  pagePath: string | null;
  search: string | null;
  /** 1–5 stars. Required for an opinion; on a problem report only kept
   *  when the person is signed in (stars only count from accounts). */
  rating: number | null;
}

export type FeedbackValidation =
  | { ok: true; value: FeedbackInput }
  // Honeypot filled in: answer as if it worked, store nothing.
  | { ok: true; spam: true }
  | { ok: false; error: string };

function clean(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  // Control characters out (newlines and tabs stay), then trim and clip.
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max);
}

function cleanRating(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5 ? value : null;
}

function cleanPath(value: unknown): string | null {
  const raw = clean(value, FEEDBACK_LIMITS.pagePath);
  // Same-site path only, without query or hash (they can carry personal data).
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  return raw.split(/[?#]/)[0] || null;
}

export function validateFeedback(body: unknown): FeedbackValidation {
  if (!body || typeof body !== "object") return { ok: false, error: "Solicitud inválida." };
  const input = body as Record<string, unknown>;
  if (clean(input.website, 200)) return { ok: true, spam: true };

  const kind = input.kind;
  if (kind !== "problem" && kind !== "opinion") return { ok: false, error: "Tipo de mensaje inválido." };
  const categories: readonly { id: string }[] = kind === "problem" ? PROBLEM_CATEGORIES : OPINION_CATEGORIES;
  const category = typeof input.category === "string" ? input.category : "";
  if (!categories.some((c) => c.id === category)) return { ok: false, error: "Elige una opción." };

  const message = clean(input.message, FEEDBACK_LIMITS.message);
  const withContext = input.attachContext === true;
  const rating = cleanRating(input.rating);

  if (kind === "problem") {
    return {
      ok: true,
      value: {
        kind,
        category,
        message,
        displayName: null,
        city: null,
        pagePath: withContext ? cleanPath(input.pagePath) : null,
        search: withContext ? clean(input.search, FEEDBACK_LIMITS.search) || null : null,
        rating
      }
    };
  }

  if (rating === null) return { ok: false, error: "Elige una calificación de 1 a 5 estrellas." };

  if (input.consentPublish !== true) {
    return { ok: false, error: "Para publicar tu opinión necesitamos tu autorización." };
  }
  if (message.length < FEEDBACK_LIMITS.opinionMessageMin) {
    return { ok: false, error: "Cuéntanos un poco más (al menos 10 caracteres)." };
  }
  // The public name is never typed: the server fills it from the signed-in
  // account (publicDisplayName). The API refuses opinions without a session.
  return {
    ok: true,
    value: {
      kind,
      category,
      message,
      displayName: null,
      city: null,
      pagePath: null,
      search: null,
      rating
    }
  };
}

// "Ana María Pérez" -> "Ana P."; one word -> that word; no name -> a neutral
// label. Never the email. Used by the server (stored with the opinion) and
// by the form ("Publicarás como …"), so both always agree.
export function publicDisplayName(name: string | null | undefined): string {
  // Some accounts carry their email as "name": never show any part of it.
  if (!name || name.includes("@")) return "Persona registrada";
  const words = name.replace(/[^\p{L}\p{M}' -]/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "Persona registrada";
  const first = words[0]!.slice(0, 30);
  const last = words.length > 1 ? ` ${words[words.length - 1]!.charAt(0).toUpperCase()}.` : "";
  return `${first.charAt(0).toUpperCase()}${first.slice(1)}${last}`;
}

export function opinionCategoryLabel(id: string): string {
  return OPINION_CATEGORIES.find((c) => c.id === id)?.label ?? "Opinión";
}

// What a published opinion exposes to the page and the API.
export interface PublishedOpinion {
  id: string;
  category: string;
  message: string;
  displayName: string;
  city: string | null;
  publishedAt: string;
  teamReply: string | null;
  rating: number;
}

// Average over ALL published opinions (not only the 30 listed). Opinions
// are published by hand, and the rule is: publish every genuine opinion
// whatever its stars; reject only spam, abuse or personal data.
export interface OpinionsSummary {
  count: number;
  average: number | null;
  /** distribution[0] = 5 stars … distribution[4] = 1 star. */
  distribution: [number, number, number, number, number];
}

export function formatRating(value: number): string {
  return value.toLocaleString("es-CO", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

// Router state the dashboard passes when someone taps "Repórtalo" on an
// error card: no query string, so /opiniones never gets ?-variants and the
// search text stays out of URLs and logs.
export interface FeedbackLinkState {
  feedback?: { kind?: FeedbackKind; category?: string; pagePath?: string; search?: string };
}
