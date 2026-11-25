import { z } from "zod";

// AI Resume Studio — R1 (ADR 0017): the base CV, written and edited by hand.
// Shared by the server (validation) and the lazy /hoja-de-vida chunk (form,
// preview). No process.env / import.meta.env here, and never imported by the
// main bundle: only src/server/routes/resume.ts and the lazy page use it.
//
// The schema is the whole contract of `facts_json`. Objects are strict, so a
// field that isn't listed (photo, cédula, estado civil, EPS…) is rejected,
// not stored (doc 09 P10). Every fact has an id so R3's factuality validator
// can cite it; `source` is "user" for everything typed in R1 and
// `sourceSpan` stays null until extraction from a file exists.

export const RESUME_POLICY_VERSION = "v2026-11";
export const RESUME_BODY_MAX_BYTES = 64 * 1024;
export const RESUME_VERSIONS_KEPT = 50;
export const RESUME_TITLE_MAX = 80;

export const RESUME_TEMPLATES = [
  { id: "clasica", label: "Clásica", description: "Serif sobria, secciones con línea. Para cualquier cargo." },
  { id: "moderna", label: "Moderna", description: "Sans serif con acento verde. Para perfiles comerciales y tecnológicos." },
  { id: "compacta", label: "Compacta", description: "Letra menor y márgenes cortos. Para mucha experiencia en una página." }
] as const;
export type ResumeTemplateId = (typeof RESUME_TEMPLATES)[number]["id"];
export const RESUME_TEMPLATE_IDS = RESUME_TEMPLATES.map((t) => t.id) as [ResumeTemplateId, ...ResumeTemplateId[]];

export type ConsentPurpose = "cv_processing" | "terms" | "cloud_storage";

export interface ConsentItem {
  purpose: ConsentPurpose;
  required: boolean;
  label: string;
  linkLabel: string;
  /** Full text behind the link. Its SHA-256 is stored with each decision. */
  text: string;
}

// Borrador pendiente de revisión legal (D4). Changing any text means a new
// RESUME_POLICY_VERSION: rows keep the version and hash they were given with.
export const CONSENT_ITEMS: readonly ConsentItem[] = [
  {
    purpose: "cv_processing",
    required: true,
    label: "Autorizo el tratamiento de mis datos personales.",
    linkLabel: "Ver autorización",
    text:
      "Autorizo a BuscoTrabajo.co, como responsable, a tratar los datos de mi hoja de vida (contacto, experiencia, " +
      "formación, habilidades e idiomas) para crearla, editarla, mostrarla en vista previa y, cuando use esas funciones, " +
      "adaptarla a vacantes con ayuda de un proveedor de inteligencia artificial ubicado en Estados Unidos (Alibaba Cloud, " +
      "región Virginia), que puede conservar las solicitudes hasta 30 días. No debo incluir datos sensibles (foto, cédula, " +
      "estado civil, salud). Puedo conocer, actualizar, rectificar y suprimir mis datos, descargar una copia y revocar " +
      "esta autorización en cualquier momento desde esta misma página; al revocarla se borra la hoja de vida guardada en " +
      "mi cuenta (Ley 1581 de 2012, art. 8). Las consultas se " +
      "responden en 10 días hábiles y los reclamos en 15. Política de privacidad: /legal/privacidad."
  },
  {
    purpose: "terms",
    required: true,
    label: "Acepto los términos del servicio.",
    linkLabel: "Ver términos",
    text:
      "Crear y editar tu hoja de vida base es gratis. Las vacantes, la búsqueda y los enlaces para aplicar siguen gratis y " +
      "sin condiciones. Los pases de pago, cuando existan, serán de pago único y sin renovación automática; su precio, lo " +
      "que incluyen y el derecho de retracto se muestran antes de pagar. No prometemos superar filtros automáticos de " +
      "selección (ATS). Términos generales: /legal/terminos."
  },
  {
    purpose: "cloud_storage",
    required: false,
    label: "Guardar mi hoja de vida en mi cuenta (opcional).",
    linkLabel: "Qué guardamos",
    text:
      "Si marcas esta casilla, guardamos en tu cuenta el contenido de tu hoja de vida, la plantilla elegida y hasta 50 " +
      "versiones anteriores para que puedas deshacer cambios. No guardamos archivos ni fotos. Solo tú puedes verla. Puedes " +
      "descargar todo en JSON o borrarlo en cualquier momento. Sin esta casilla, la hoja de vida vive solo en este navegador; " +
      "si la desmarcas después, pasamos tu última versión a este navegador y borramos la copia guardada en tu cuenta."
  }
];

const MONTH = /^$|^(19|20)\d{2}-(0[1-9]|1[0-2])$/;
const ID = z.string().regex(/^[a-z0-9-]{1,40}$/);
const line = (max: number) => z.string().trim().max(max);
const month = z.string().trim().regex(MONTH, "Usa el formato AAAA-MM.");
const factMeta = {
  id: ID,
  // R3 widens this additively: "file" = extracted from the user's own
  // uploaded CV with a verified sourceSpan. R1 rows ("user") stay valid.
  source: z.enum(["user", "file"]).default("user"),
  sourceSpan: z
    .object({ start: z.number().int().min(0), end: z.number().int().min(0) })
    .strict()
    .nullable()
    .default(null)
};

const link = z
  .string()
  .trim()
  .max(200)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password;
    } catch {
      return false;
    }
  }, "Enlace no válido (debe empezar por https://).");

export const resumeFactsSchema = z
  .object({
    schemaVersion: z.literal(1),
    basics: z
      .object({
        fullName: line(80),
        headline: line(120),
        email: z.union([z.literal(""), z.string().trim().max(120).email("Correo no válido.")]),
        phone: line(30).regex(/^[0-9+()\-\s]*$/, "Teléfono no válido."),
        city: line(80),
        links: z.array(link).max(5)
      })
      .strict(),
    summary: line(1200),
    experience: z
      .array(
        z
          .object({
            ...factMeta,
            role: line(120),
            company: line(120),
            city: line(80),
            startDate: month,
            endDate: month,
            current: z.boolean(),
            bullets: z.array(z.object({ ...factMeta, text: line(300) }).strict()).max(8)
          })
          .strict()
      )
      .max(15),
    education: z
      .array(
        z
          .object({ ...factMeta, degree: line(120), institution: line(120), city: line(80), startDate: month, endDate: month })
          .strict()
      )
      .max(10),
    certifications: z
      .array(z.object({ ...factMeta, name: line(120), issuer: line(120), date: month }).strict())
      .max(15),
    skills: z.array(z.object({ ...factMeta, name: line(60) }).strict()).max(40),
    languages: z.array(z.object({ ...factMeta, name: line(40), level: line(40) }).strict()).max(8)
  })
  .strict();

export type ResumeFacts = z.infer<typeof resumeFactsSchema>;

export const resumeInputSchema = z
  .object({
    title: line(RESUME_TITLE_MAX).min(1, "Ponle un nombre a tu hoja de vida."),
    templateId: z.enum(RESUME_TEMPLATE_IDS),
    facts: resumeFactsSchema
  })
  .strict();
export type ResumeInput = z.infer<typeof resumeInputSchema>;

export function emptyResumeFacts(): ResumeFacts {
  return {
    schemaVersion: 1,
    basics: { fullName: "", headline: "", email: "", phone: "", city: "", links: [] },
    summary: "",
    experience: [],
    education: [],
    certifications: [],
    skills: [],
    languages: []
  };
}

/** Short random id for a new fact ("exp-k3j9x2"). Not security relevant. */
export function newFactId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

/** "2024-03" → "mar. 2024"; "" → "". */
export function formatResumeMonth(value: string): string {
  if (!MONTH.test(value) || !value) return "";
  const [year, monthNo] = value.split("-").map(Number);
  const names = ["ene.", "feb.", "mar.", "abr.", "may.", "jun.", "jul.", "ago.", "sep.", "oct.", "nov.", "dic."];
  return `${names[monthNo - 1]} ${year}`;
}

export function formatResumeRange(start: string, end: string, current = false): string {
  const from = formatResumeMonth(start);
  const to = current ? "actual" : formatResumeMonth(end);
  if (from && to) return `${from} – ${to}`;
  return from || to;
}

/** Strict on/off: only the literal string "true" turns the module on. */
export function parseResumeStudioFlag(value: string | undefined): boolean {
  return value === "true";
}
